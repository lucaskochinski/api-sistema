'use strict';

const { Op } = require('sequelize');
const Stripe = require('stripe');
const db = require('../../../Models');
const billingService = require('../../Billing/billing.service');
const planLimits = require('../../../Services/plan_limits.service');
const integrationConfig = require('../../../Services/integration_config.service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

function stripeClientOrNull() {
  const key = integrationConfig.get('stripe_secret_key');
  if (!key || !String(key).trim()) return null;
  return new Stripe(String(key).trim());
}

function serializePlanRow(plan) {
  if (!plan) return null;
  const plain = plan.get ? plan.get({ plain: true }) : plan;
  return {
    id: plain.id,
    tierKey: plain.tierKey,
    displayName: plain.displayName,
    trialDays: plain.trialDays,
    priceAmountCents: plain.priceAmountCents,
    priceCurrency: plain.priceCurrency,
    isPublic: plain.isPublic,
    isActive: plain.isActive,
    customOrganizationId: plain.customOrganizationId,
    limits: plain.limits,
  };
}

function serializeSubscriptionRow(sub) {
  if (!sub) return null;
  const plain = sub.get ? sub.get({ plain: true }) : sub;
  return {
    id: plain.id,
    organizationId: plain.organizationId,
    planId: plain.planId,
    status: plain.status,
    cancelAtPeriodEnd: Boolean(plain.cancelAtPeriodEnd),
    currentPeriodStart: plain.currentPeriodStart,
    currentPeriodEnd: plain.currentPeriodEnd,
    trialEndsAt: plain.trialEndsAt,
    canceledAt: plain.canceledAt,
    stripeSubscriptionId: plain.stripeSubscriptionId,
    billingMetadata: plain.billingMetadata || {},
    plan: plain.plan ? serializePlanRow(plain.plan) : null,
  };
}

function readIsoDate(raw, fieldName) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`invalid_${fieldName}`);
    err.statusCode = 400;
    throw err;
  }
  return d;
}

function readPeriodDays(body, fallback = 30) {
  const raw = body.periodDays ?? body.period_days ?? body.durationDays ?? body.duration_days;
  if (raw == null || raw === '') return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    const err = new Error('invalid_period_days');
    err.statusCode = 400;
    throw err;
  }
  return n;
}

async function assertOrganizationExists(organizationId) {
  const orgId = String(organizationId || '').trim();
  if (!UUID_RE.test(orgId)) {
    const err = new Error('invalid_organization');
    err.statusCode = 400;
    throw err;
  }
  const org = await db.Organization.findByPk(orgId);
  if (!org) {
    const err = new Error('organization_not_found');
    err.statusCode = 404;
    throw err;
  }
  return org;
}

async function assertPlanForOrganization(planId, organizationId) {
  const pid = String(planId || '').trim();
  if (!UUID_RE.test(pid)) {
    const err = new Error('invalid_plan');
    err.statusCode = 400;
    throw err;
  }
  const plan = await db.Plan.findByPk(pid);
  if (!plan || !plan.isActive) {
    const err = new Error('plan_not_found_or_inactive');
    err.statusCode = 404;
    throw err;
  }
  const exclusiveOrgId = plan.customOrganizationId
    ? String(plan.customOrganizationId)
    : null;
  if (exclusiveOrgId && exclusiveOrgId !== String(organizationId)) {
    const err = new Error('plan_checkout_organization_mismatch');
    err.statusCode = 403;
    throw err;
  }
  return plan;
}

async function listPlansForOrganization(organizationId) {
  const orgId = String(organizationId);
  const rows = await db.Plan.findAll({
    where: {
      isActive: true,
      [Op.or]: [
        { isPublic: true, customOrganizationId: null },
        { customOrganizationId: orgId },
      ],
    },
    order: [
      ['priceAmountCents', 'ASC NULLS LAST'],
      ['displayName', 'ASC'],
    ],
  });
  return rows.map(serializePlanRow);
}

async function getOrganizationBillingContext(organizationId) {
  const org = await assertOrganizationExists(organizationId);

  const [activeSubscription, subscriptions, availablePlans] = await Promise.all([
    planLimits.getSubscriptionWithPlan(org.id),
    db.Subscription.findAll({
      where: { organizationId: org.id },
      include: [{ model: db.Plan, as: 'plan', required: false }],
      order: [['updatedAt', 'DESC']],
      limit: 20,
    }),
    listPlansForOrganization(org.id),
  ]);

  return {
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      stripeCustomerId: org.stripeCustomerId,
    },
    activeSubscription: serializeSubscriptionRow(activeSubscription),
    subscriptions: subscriptions.map(serializeSubscriptionRow),
    availablePlans,
  };
}

async function deactivateOtherActiveSubscriptions(organizationId, exceptId, transaction) {
  const where = {
    organizationId,
    status: { [Op.in]: ACTIVE_STATUSES },
  };
  if (exceptId) where.id = { [Op.ne]: exceptId };

  await db.Subscription.update(
    {
      status: 'canceled',
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
    },
    { where, transaction },
  );
}

/**
 * Atribui plano manualmente (grátis, trial admin, cortesia).
 * @param {'free'|'trial'|'comp'} [mode]
 */
async function grantOrganizationPlan({
  organizationId,
  planId,
  grantedByUserId,
  mode = 'free',
  status = 'active',
  periodDays = 30,
  periodEnd = null,
  trialDays = null,
  trialEndsAt = null,
  notes = '',
  replaceExisting = true,
}) {
  await assertOrganizationExists(organizationId);
  const plan = await assertPlanForOrganization(planId, organizationId);

  const normalizedStatus = String(status || 'active').trim().toLowerCase();
  if (!['active', 'trialing'].includes(normalizedStatus)) {
    const err = new Error('invalid_subscription_status');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const endDate =
    readIsoDate(periodEnd, 'period_end') ||
    new Date(now.getTime() + readPeriodDays({ periodDays }, 30) * 86400000);

  let trialEnd = null;
  if (normalizedStatus === 'trialing') {
    trialEnd =
      readIsoDate(trialEndsAt, 'trial_ends_at') ||
      new Date(
        now.getTime() +
          (Number.isFinite(Number(trialDays))
            ? Number(trialDays)
            : Number(plan.trialDays) || 14) *
            86400000,
      );
  }

  let created;
  await db.sequelize.transaction(async (transaction) => {
    if (replaceExisting) {
      await deactivateOtherActiveSubscriptions(organizationId, null, transaction);
    }

    created = await db.Subscription.create(
      {
        organizationId,
        planId: plan.id,
        status: normalizedStatus,
        stripeSubscriptionId: null,
        stripePriceIdSnapshot: plan.stripePriceId || null,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        trialEndsAt: trialEnd,
        cancelAtPeriodEnd: false,
        billingMetadata: {
          source: 'admin_grant',
          mode: String(mode || 'free'),
          notes: String(notes || '').slice(0, 2000),
          grantedBy: grantedByUserId ? String(grantedByUserId) : null,
          grantedAt: now.toISOString(),
          replaceExisting: Boolean(replaceExisting),
        },
        rawStripeSnapshot: {},
      },
      { transaction },
    );
  });

  const full = await db.Subscription.findByPk(created.id, {
    include: [{ model: db.Plan, as: 'plan', required: true }],
  });

  return {
    subscription: serializeSubscriptionRow(full),
    message:
      normalizedStatus === 'trialing'
        ? 'Plano activado em trial administrativo.'
        : 'Plano activado gratuitamente pela administração.',
  };
}

async function createAdminCheckoutLink({
  organizationId,
  planId,
  billingEmail,
  billingName,
}) {
  await assertOrganizationExists(organizationId);
  await assertPlanForOrganization(planId, organizationId);

  const email = String(billingEmail || '').trim();
  if (!email || !email.includes('@')) {
    const err = new Error('billing_email_required');
    err.statusCode = 400;
    throw err;
  }

  const session = await billingService.createCheckoutSession({
    organizationId,
    planId,
    billingEmail: email,
    billingName: billingName ? String(billingName).slice(0, 255) : undefined,
  });

  return {
    checkoutUrl: session.checkoutUrl,
    sessionId: session.sessionId,
    message: 'Link de pagamento Stripe gerado. Envie ao cliente ou abra numa nova aba.',
  };
}

async function updateOrganizationSubscription({
  organizationId,
  subscriptionId,
  planId,
  status,
  periodEnd,
  trialEndsAt,
  notes,
  actorUserId,
}) {
  await assertOrganizationExists(organizationId);
  const sub = await db.Subscription.findOne({
    where: { id: subscriptionId, organizationId },
    include: [{ model: db.Plan, as: 'plan', required: false }],
  });
  if (!sub) {
    const err = new Error('subscription_not_found');
    err.statusCode = 404;
    throw err;
  }

  const patch = {};
  if (planId) {
    const plan = await assertPlanForOrganization(planId, organizationId);
    patch.planId = plan.id;
    patch.stripePriceIdSnapshot = plan.stripePriceId || sub.stripePriceIdSnapshot;
  }
  if (status) {
    const normalized = String(status).trim().toLowerCase();
    if (!['active', 'trialing', 'canceled', 'paused'].includes(normalized)) {
      const err = new Error('invalid_subscription_status');
      err.statusCode = 400;
      throw err;
    }
    patch.status = normalized;
    if (normalized === 'canceled') patch.canceledAt = new Date();
  }
  if (periodEnd != null) patch.currentPeriodEnd = readIsoDate(periodEnd, 'period_end');
  if (trialEndsAt != null) patch.trialEndsAt = readIsoDate(trialEndsAt, 'trial_ends_at');

  const meta = { ...(sub.billingMetadata || {}) };
  meta.lastAdminUpdateAt = new Date().toISOString();
  if (actorUserId) meta.lastUpdatedBy = String(actorUserId);
  if (notes != null) meta.adminNotes = String(notes).slice(0, 2000);
  patch.billingMetadata = meta;

  await sub.update(patch);

  const refreshed = await db.Subscription.findByPk(sub.id, {
    include: [{ model: db.Plan, as: 'plan', required: true }],
  });

  return { subscription: serializeSubscriptionRow(refreshed) };
}

async function revokeOrganizationSubscription({
  organizationId,
  subscriptionId,
  reason = '',
  actorUserId,
  cancelStripe = true,
}) {
  await assertOrganizationExists(organizationId);
  const sub = await db.Subscription.findOne({
    where: { id: subscriptionId, organizationId },
    include: [{ model: db.Plan, as: 'plan', required: false }],
  });
  if (!sub) {
    const err = new Error('subscription_not_found');
    err.statusCode = 404;
    throw err;
  }

  if (cancelStripe && sub.stripeSubscriptionId) {
    const stripe = stripeClientOrNull();
    if (stripe) {
      try {
        await stripe.subscriptions.cancel(String(sub.stripeSubscriptionId));
      } catch (e) {
        console.warn('[admin_revoke] stripe cancel failed:', e?.message || e);
      }
    }
  }

  const meta = { ...(sub.billingMetadata || {}) };
  meta.revokedAt = new Date().toISOString();
  meta.revokedBy = actorUserId ? String(actorUserId) : null;
  meta.revokeReason = String(reason || '').slice(0, 2000);

  await sub.update({
    status: 'canceled',
    canceledAt: new Date(),
    cancelAtPeriodEnd: false,
    billingMetadata: meta,
  });

  const refreshed = await db.Subscription.findByPk(sub.id, {
    include: [{ model: db.Plan, as: 'plan', required: false }],
  });

  return {
    subscription: serializeSubscriptionRow(refreshed),
    message: 'Assinatura revogada pela administração.',
  };
}

module.exports = {
  getOrganizationBillingContext,
  grantOrganizationPlan,
  createAdminCheckoutLink,
  updateOrganizationSubscription,
  revokeOrganizationSubscription,
  listPlansForOrganization,
  serializeSubscriptionRow,
};
