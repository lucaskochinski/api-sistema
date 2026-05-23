'use strict';

const Stripe = require('stripe');
const { UniqueConstraintError, Op } = require('sequelize');
const db = require('../../Models');
const planLimits = require('../../Services/plan_limits.service');
const integrationConfig = require('../../Services/integration_config.service');
const stripePlans = require('../../Services/stripe_plans.service');
const transcriptionUsage = require('../../Services/transcription_usage.service');

let _stripe;

function stripeSecret() {
  const k = integrationConfig.get('stripe_secret_key');
  if (!k || !String(k).trim()) {
    const err = new Error('STRIPE_SECRET_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }
  return String(k).trim();
}

function webhookSecret() {
  const w = integrationConfig.get('stripe_webhook_secret');
  if (!w || !String(w).trim()) {
    const err = new Error('STRIPE_WEBHOOK_SECRET_not_configured');
    err.statusCode = 503;
    throw err;
  }
  return String(w).trim();
}

function resetStripeClient() {
  _stripe = null;
}

function stripeClient() {
  if (!_stripe) {
    _stripe = new Stripe(stripeSecret());
  }
  return _stripe;
}

function publicBaseUrl() {
  return integrationConfig.getPublicAppUrl();
}

function isStripeConfigured() {
  return Boolean(integrationConfig.get('stripe_secret_key'));
}

function isDemoStripePriceId(priceId) {
  const id = priceId ? String(priceId).trim() : '';
  return !id || id.startsWith('price_hooko_');
}

function planHasBillablePrice(plan) {
  const cents = Number(plan?.priceAmountCents ?? plan?.price_amount_cents);
  return Number.isFinite(cents) && cents >= 50;
}

function planCanCheckout(plan) {
  if (!planHasBillablePrice(plan)) return false;
  const priceId = plan.stripePriceId ? String(plan.stripePriceId).trim() : '';
  if (priceId && !isDemoStripePriceId(priceId)) return true;
  return isStripeConfigured();
}

/** Sincroniza preço no Stripe quando o plano só tem valor local ou ID demo. */
async function ensurePlanStripePrice(plan) {
  if (!planHasBillablePrice(plan)) {
    const err = new Error('plan_missing_price');
    err.statusCode = 422;
    throw err;
  }

  const currentId = plan.stripePriceId ? String(plan.stripePriceId).trim() : '';
  if (currentId && !isDemoStripePriceId(currentId)) {
    return currentId;
  }

  if (!isStripeConfigured()) {
    const err = new Error('plan_missing_stripe_price_id');
    err.statusCode = 422;
    throw err;
  }

  const synced = await stripePlans.ensureStripePlan({
    tierKey: plan.tierKey,
    displayName: plan.displayName,
    amountCents: plan.priceAmountCents,
    currency: plan.priceCurrency || 'brl',
  });

  await plan.update({
    stripePriceId: synced.priceId,
    stripeProductId: synced.productId,
    priceAmountCents: synced.amountCents,
    priceCurrency: synced.currency,
  });

  return synced.priceId;
}

function sanitizeStripeSubscriptionSnapshot(sub) {
  if (!sub || typeof sub !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(sub));
  } catch (_) {
    return { id: sub.id, fallback: true };
  }
}

function stripeStatusForDb(raw) {
  const s = raw ? String(raw).toLowerCase() : '';
  if (!s) return 'unknown';
  return s;
}

async function ensureStripeCustomerForOrganization({
  organizationId,
  billingEmail,
  billingName,
}) {
  const org = await db.Organization.findByPk(organizationId);
  if (!org) {
    const err = new Error('organization_not_found');
    err.statusCode = 404;
    throw err;
  }

  const stripe = stripeClient();
  if (org.stripeCustomerId) {
    return { organization: org, customerId: org.stripeCustomerId };
  }

  const customer = await stripe.customers.create({
    name: billingName ? String(billingName).slice(0, 255) : org.name || undefined,
    email: billingEmail ? String(billingEmail).trim() : undefined,
    metadata: { organization_id: String(organization.id) },
  });

  await org.update({ stripeCustomerId: customer.id });
  return { organization: org, customerId: customer.id };
}

async function createCheckoutSession({
  organizationId,
  planId,
  billingEmail,
  billingName,
}) {
  const plan = await db.Plan.findByPk(planId);
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

  const priceId = await ensurePlanStripePrice(plan);

  const td = Number(plan.trialDays != null ? plan.trialDays : 0);
  const trialDays = Number.isFinite(td)
    ? Math.min(Math.max(Math.floor(td), 0), 730)
    : 0;

  const { customerId } = await ensureStripeCustomerForOrganization({
    organizationId,
    billingEmail,
    billingName,
  });

  const base = publicBaseUrl();
  const stripe = stripeClient();

  /** @type {import('stripe').Stripe.Checkout.SessionCreateParams} */
  const payload = {
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(organizationId),
    metadata: {
      organization_id: String(organizationId),
      plan_id: String(plan.id),
      plan_tier_key: String(plan.tierKey || ''),
    },
    subscription_data: {
      metadata: {
        organization_id: String(organizationId),
        plan_id: String(plan.id),
      },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url:
      process.env.STRIPE_CHECKOUT_SUCCESS_URL ||
      `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:
      process.env.STRIPE_CHECKOUT_CANCEL_URL || `${base}/billing/cancel`,
  };

  const session = await stripe.checkout.sessions.create(payload);
  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    customerId,
  };
}

async function createPortalSession({ organizationId, returnUrl }) {
  const org = await db.Organization.findByPk(organizationId);
  if (!org || !org.stripeCustomerId) {
    const err = new Error('stripe_customer_not_linked_for_organization');
    err.statusCode = 422;
    throw err;
  }

  const base = publicBaseUrl();
  const stripe = stripeClient();

  /** @type {import('stripe').Stripe.BillingPortal.SessionCreateParams} */
  const params = {
    customer: String(org.stripeCustomerId),
    return_url:
      returnUrl ||
      process.env.STRIPE_BILLING_PORTAL_RETURN_URL ||
      `${base}/billing`,
  };

  const cfg =
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim?.() ||
    '';
  /** @type {import('stripe').Stripe.BillingPortal.Session} */
  const session =
    cfg.length > 0
      ? await stripe.billingPortal.sessions.create({
          ...params,
          configuration: cfg,
        })
      : await stripe.billingPortal.sessions.create(params);

  return { portalUrl: session.url };
}

function pickPriceIdFromSubscription(subLike) {
  const item0 = subLike?.items?.data?.[0];
  const pid = item0?.price?.id ? String(item0.price.id) : '';
  return pid || '';
}

async function resolvePlanUuidFromStripeSubscription(subLike, fallbackPlanId) {
  const metaPid =
    fallbackPlanId ?
      String(fallbackPlanId)
    : subLike.metadata?.plan_id ? String(subLike.metadata.plan_id) : '';
  if (
    metaPid &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      metaPid,
    )
  ) {
    const exists = await db.Plan.findByPk(metaPid, {
      attributes: ['id'],
    });
    if (exists) return exists.id;
  }

  const priceId = pickPriceIdFromSubscription(subLike);
  if (priceId) {
    const p = await db.Plan.findOne({
      where: { stripePriceId: priceId },
      attributes: ['id'],
    });
    if (p) return p.id;
  }

  return null;
}

async function persistSubscriptionFromStripeObject(stripeSubscription) {
  const stripeSubId = String(stripeSubscription.id);

  const existingRow = await db.Subscription.findOne({
    where: { stripeSubscriptionId: stripeSubId },
  });

  let organizationId =
    stripeSubscription.metadata?.organization_id
      ? String(stripeSubscription.metadata.organization_id).trim()
      : '';

  const customerRaw = stripeSubscription.customer;
  const customerId =
    typeof customerRaw === 'string'
      ? customerRaw
      : customerRaw?.id || null;

  if (!organizationId && customerId) {
    const hit = await db.Organization.findOne({
      where: { stripeCustomerId: customerId },
      attributes: ['id'],
    });
    if (hit) organizationId = String(hit.id);
  }

  if (!organizationId && existingRow?.organizationId) {
    organizationId = String(existingRow.organizationId);
  }

  const planFallback = stripeSubscription.metadata?.plan_id || null;

  let planUuid = await resolvePlanUuidFromStripeSubscription(
    stripeSubscription,
    planFallback,
  );
  if (!planUuid && existingRow?.planId) {
    planUuid = existingRow.planId;
  }

  if (!organizationId || !planUuid) {
    console.warn('[stripe_webhook] missing organization_id or resolved plan UUID', {
      stripeSubscriptionId: stripeSubscription?.id || null,
    });
    return { skipped: true };
  }

  const priceSnap = pickPriceIdFromSubscription(stripeSubscription);
  const invoiceRef =
    typeof stripeSubscription.latest_invoice === 'string'
      ? stripeSubscription.latest_invoice
      : stripeSubscription.latest_invoice?.id || null;

  const attrs = {
    organizationId,
    planId: planUuid,
    stripeSubscriptionId: stripeSubId,
    stripePriceIdSnapshot: priceSnap || null,
    stripeLatestInvoiceId: invoiceRef,
    status: stripeStatusForDb(stripeSubscription.status),
    cancelAtPeriodEnd: !!stripeSubscription.cancel_at_period_end,
    currentPeriodStart: stripeSubscription.current_period_start
      ? new Date(Number(stripeSubscription.current_period_start) * 1000)
      : null,
    currentPeriodEnd: stripeSubscription.current_period_end
      ? new Date(Number(stripeSubscription.current_period_end) * 1000)
      : null,
    canceledAt: stripeSubscription.canceled_at
      ? new Date(Number(stripeSubscription.canceled_at) * 1000)
      : null,
    rawStripeSnapshot: sanitizeStripeSubscriptionSnapshot(stripeSubscription),
  };

  if (existingRow) await existingRow.update(attrs);
  else {
    await db.Subscription.create({
      ...attrs,
      billingMetadata: {
        syncedFromStripeAt: new Date().toISOString(),
      },
    });
  }

  if (customerId) {
    await db.Organization.update(
      { stripeCustomerId: customerId },
      { where: { id: organizationId, stripeCustomerId: null } },
    );
  }

  return { synced: true, organizationId };
}

async function processStripeEventPersisted(event) {
  const type = event.type;

  if (type === 'checkout.session.completed') {
    const session = /** @type {Record<string, any>} */ (event.data?.object || {});
    if (session.mode && session.mode !== 'subscription')
      return { handled: false };

    let subRef = session.subscription;

    /** @type {import('stripe').Stripe.Subscription|null} */
    let fullSub = null;

    if (typeof subRef === 'string') {
      fullSub =
        /** @type {import('stripe').Stripe.Subscription} */ (
          await stripeClient().subscriptions.retrieve(subRef, {
            expand: ['items.data.price'],
          })
        );

      fullSub.metadata = {
        ...(fullSub.metadata || {}),
        ...(session.metadata?.organization_id
          ? { organization_id: String(session.metadata.organization_id) }
          : {}),
        ...(session.metadata?.plan_id
          ? { plan_id: String(session.metadata.plan_id) }
          : {}),
      };
    } else if (subRef?.id && subRef.items?.data) {
      fullSub =
        /** @type {import('stripe').Stripe.Subscription} */ /** @type {unknown} */ (
          subRef
        );

      fullSub.metadata = {
        ...(fullSub.metadata || {}),
        ...(session.metadata?.organization_id
          ? { organization_id: String(session.metadata.organization_id) }
          : {}),
        ...(session.metadata?.plan_id
          ? { plan_id: String(session.metadata.plan_id) }
          : {}),
      };
    }

    if (!fullSub?.id) return { handled: false };

    await persistSubscriptionFromStripeObject(fullSub);
    return { handled: true };
  }

  if (
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
    const sub = /** @type {Record<string, any>} */ (event.data?.object || {});
    if (!sub?.id) return { handled: false };

    await persistSubscriptionFromStripeObject(sub);
    return { handled: true };
  }

  return { handled: false };
}

/**
 * @param {string|undefined|null} stripeSignatureHeader
 * @param {Buffer|string} rawBody Buffer do `express.raw({ type:'application/json' })`
 */
async function handleStripeWebhook(stripeSignatureHeader, rawBody) {
  if (!stripeSignatureHeader) {
    const err = new Error('stripe_signature_missing');
    err.statusCode = 400;
    throw err;
  }

  const buf =
    Buffer.isBuffer(rawBody) ?
      rawBody
    : Buffer.from(String(rawBody ?? ''), 'utf8');

  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      buf,
      stripeSignatureHeader,
      webhookSecret(),
    );
  } catch (e) {
    const err = new Error(`stripe_signature_invalid:${e.message || ''}`);
    err.statusCode = 400;
    throw err;
  }

  /** @type {Record<string,string>} */
  const headersSnapshotStub = {};

  let eventLog;
  try {
    eventLog = await db.WebhookEventLog.create({
      gateway: 'stripe',
      gatewayEventId: event.id,
      eventType: event.type,
      gatewayApiVersion: event.api_version || null,
      organizationId: null,
      stripeSignatureReceived:
        stripeSignatureHeader && String(stripeSignatureHeader).slice(0, 512),
      payloadJson: sanitizeStripeSubscriptionSnapshot(event),
      headersSnapshot: headersSnapshotStub,
      processingStatus: 'received',
    });
  } catch (createErr) {
    const dup =
      createErr instanceof UniqueConstraintError ||
      createErr?.name === 'SequelizeUniqueConstraintError';
    if (!dup) throw createErr;

    eventLog =
      /** @type {import('sequelize').Model & {processingStatus:string}} */ (
        await db.WebhookEventLog.findOne({
          where: { gateway: 'stripe', gatewayEventId: event.id },
        })
      );

    if (eventLog?.processingStatus === 'processed') {
      return { received: true, duplicate: true, alreadyProcessed: true };
    }
    if (!eventLog) throw createErr;
  }

  try {
    const outcomes = await processStripeEventPersisted(event);

    await eventLog.update({
      processingStatus: 'processed',
      processedAt: new Date(),
      lastErrorDetail: outcomes.handled ? null : `unhandled_type:${event.type}`,
    });

    return { received: true, duplicate: false, handledTypes: !!outcomes.handled };
  } catch (procErr) {
    console.error('[stripe_webhook] processing_failed', procErr.message);
    await eventLog.increment('processingAttemptCount', {
      by: 1,
    });
    await eventLog.update({
      processingStatus: 'dead_letter',
      lastErrorDetail: String(procErr.message || procErr),
      processedAt: null,
    });
    const wrapped = new Error('stripe_webhook_processing_failed');
    wrapped.statusCode = 500;
    wrapped.cause = procErr;
    throw wrapped;
  }
}

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing']);

function daysUntil(date) {
  if (!date) return null;
  const end = new Date(date);
  if (Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function creativeImportMetricKey() {
  return (
    process.env.USAGE_META_CREATIVE_IMPORT_KEY ||
    process.env.USAGE_META_CAMPAIGN_IMPORT_KEY ||
    'meta_creative_import_month'
  );
}

async function getCreativeUsageSnapshot(organizationId, actor = null) {
  const resolved = await planLimits.getResolvedLimitsForOrganization(
    organizationId,
    actor,
  );
  const metricKey = creativeImportMetricKey();
  const periodLabel = transcriptionUsage.monthlyPeriodLabelUtc();

  let used = 0;
  const counterRow = await db.UsageCounter.findOne({
    where: { organizationId, metricKey, periodLabel },
  }).catch(() => null);
  if (counterRow) used = Number(counterRow.value || 0);

  const rawLimit = resolved.limitless
    ? Number.POSITIVE_INFINITY
    : planLimits.creativeImportLimitFromResolved(resolved.limits);

  const limit =
    rawLimit === Number.POSITIVE_INFINITY || rawLimit == null ? null : rawLimit;

  return {
    metricKey,
    periodLabel,
    used,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - used),
    limitless: resolved.limitless,
  };
}

function serializeSubscriptionRow(sub) {
  if (!sub) return null;
  const plain = sub.get ? sub.get({ plain: true }) : sub;
  const plan = plain.plan || null;
  return {
    id: plain.id,
    status: plain.status,
    cancelAtPeriodEnd: Boolean(plain.cancelAtPeriodEnd),
    currentPeriodStart: plain.currentPeriodStart,
    currentPeriodEnd: plain.currentPeriodEnd,
    trialEndsAt: plain.trialEndsAt,
    cancelAt: plain.cancelAt,
    canceledAt: plain.canceledAt,
    plan: plan
      ? {
          id: plan.id,
          tierKey: plan.tierKey,
          displayName: plan.displayName,
          limits: plan.limits,
          trialDays: plan.trialDays,
          priceAmountCents: plan.priceAmountCents,
          priceCurrency: plan.priceCurrency,
        }
      : null,
  };
}

function buildBillingAlerts(subRow) {
  /** @type {Array<{ type: string, severity: string, title: string, message: string, daysLeft?: number }>} */
  const alerts = [];

  if (!subRow) {
    alerts.push({
      type: 'no_subscription',
      severity: 'critical',
      title: 'Escolha um plano',
      message: 'A sua organização ainda não tem uma assinatura activa. Seleccione um plano para usar o HOOKO.',
    });
    return alerts;
  }

  const status = String(subRow.status || '').toLowerCase();

  if (status === 'past_due' || status === 'unpaid') {
    alerts.push({
      type: 'payment_past_due',
      severity: 'critical',
      title: 'Pagamento pendente',
      message: 'Há um problema com o pagamento da assinatura. Actualize o método de pagamento para evitar interrupção.',
    });
  }

  if (status === 'trialing') {
    const daysLeft = daysUntil(subRow.trialEndsAt || subRow.currentPeriodEnd);
    if (daysLeft != null && daysLeft <= 7) {
      alerts.push({
        type: 'trial_ending',
        severity: daysLeft <= 3 ? 'warning' : 'info',
        title: 'Trial a terminar',
        message:
          daysLeft <= 0
            ? 'O seu período de trial termina hoje. Confirme o plano para continuar.'
            : `Faltam ${daysLeft} dia(s) para o fim do trial.`,
        daysLeft,
      });
    }
  }

  if (subRow.cancelAtPeriodEnd) {
    const daysLeft = daysUntil(subRow.currentPeriodEnd);
    alerts.push({
      type: 'cancel_scheduled',
      severity: 'warning',
      title: 'Cancelamento agendado',
      message:
        daysLeft != null && daysLeft > 0
          ? `A assinatura termina em ${daysLeft} dia(s). Pode reactivar no portal de billing.`
          : 'A assinatura está marcada para cancelar no fim do período actual.',
      daysLeft: daysLeft ?? undefined,
    });
  }

  if (status === 'canceled' || status === 'incomplete_expired') {
    alerts.push({
      type: 'subscription_canceled',
      severity: 'critical',
      title: 'Assinatura encerrada',
      message: 'A assinatura foi cancelada. Escolha um plano para voltar a usar o HOOKO.',
    });
  }

  if (ACTIVE_SUB_STATUSES.has(status) && !subRow.cancelAtPeriodEnd) {
    alerts.push({
      type: 'plan_active',
      severity: 'info',
      title: 'Plano activo',
      message: `Está no plano ${subRow.plan?.displayName || subRow.plan?.tierKey || 'HOOKO'}. Pode alterar ou actualizar no portal.`,
    });
  }

  return alerts;
}

/** Planos disponíveis para checkout (públicos + exclusivos da org). */
async function listCheckoutPlans(organizationId) {
  const orgId = String(organizationId || '').trim();
  const rows = await db.Plan.findAll({
    where: {
      isActive: true,
      [Op.or]: [
        { isPublic: true, customOrganizationId: null },
        { customOrganizationId: orgId },
      ],
    },
    attributes: [
      'id',
      'tierKey',
      'displayName',
      'limits',
      'trialDays',
      'isPublic',
      'customOrganizationId',
      'priceAmountCents',
      'priceCurrency',
      'stripePriceId',
    ],
    order: [
      ['priceAmountCents', 'ASC NULLS LAST'],
      ['displayName', 'ASC'],
    ],
  });

  return rows.map((row) => {
    const plain = row.get({ plain: true });
    const canCheckout = planCanCheckout(plain);
    delete plain.stripePriceId;
    return { ...plain, canCheckout };
  });
}

/**
 * Estado de billing da organização + alertas para modais no frontend.
 * @param {string} organizationId
 * @param {{ email?: string, roles?: string[] } | null} actor
 */
async function getBillingStatus(organizationId, actor = null) {
  if (planLimits.isPlatformSuperActor(actor)) {
    const usage = await getCreativeUsageSnapshot(organizationId, actor);
    return {
      hasActiveSubscription: true,
      bypass: true,
      subscription: null,
      currentPlanId: null,
      usage,
      alerts: [],
    };
  }

  const activeSub = await planLimits.getSubscriptionWithPlan(organizationId);
  const latestSub = await db.Subscription.findOne({
    where: { organizationId },
    order: [['updatedAt', 'DESC']],
    include: [
      {
        model: db.Plan,
        as: 'plan',
        attributes: ['id', 'tierKey', 'displayName', 'limits', 'trialDays', 'priceAmountCents', 'priceCurrency'],
        required: false,
      },
    ],
  });

  const subForAlerts = activeSub || latestSub;
  const serialized = serializeSubscriptionRow(subForAlerts);
  const usage = await getCreativeUsageSnapshot(organizationId, actor);
  const currentPlanId = serialized?.plan?.id ?? null;
  const hasActiveSubscription = Boolean(
    activeSub && ACTIVE_SUB_STATUSES.has(String(activeSub.status || '').toLowerCase()),
  );

  const alerts = buildBillingAlerts(serialized);
  if (hasActiveSubscription) {
    const filtered = alerts.filter((a) => a.type !== 'no_subscription' && a.type !== 'subscription_canceled');
    return {
      hasActiveSubscription: true,
      bypass: false,
      subscription: serialized,
      currentPlanId,
      usage,
      alerts: filtered.filter((a) => a.type !== 'plan_active'),
    };
  }

  return {
    hasActiveSubscription: false,
    bypass: false,
    subscription: serialized,
    currentPlanId,
    usage,
    alerts,
  };
}

/**
 * Cancela renovação automática — não cobra mais no cartão após o período actual.
 * Mantém acesso até current_period_end (cancel_at_period_end no Stripe).
 */
async function cancelSubscriptionAtPeriodEnd(organizationId) {
  const sub = await planLimits.getSubscriptionWithPlan(organizationId);
  if (!sub?.stripeSubscriptionId) {
    const err = new Error('subscription_not_found');
    err.statusCode = 404;
    throw err;
  }

  const status = String(sub.status || '').toLowerCase();
  if (!ACTIVE_SUB_STATUSES.has(status)) {
    const err = new Error('subscription_not_active');
    err.statusCode = 422;
    throw err;
  }

  if (sub.cancelAtPeriodEnd) {
    const serialized = serializeSubscriptionRow(sub);
    return {
      alreadyScheduled: true,
      subscription: serialized,
      message:
        'A renovação automática já estava cancelada. Não haverá nova cobrança após o fim do período actual.',
    };
  }

  const updated = await stripeClient().subscriptions.update(
    String(sub.stripeSubscriptionId),
    { cancel_at_period_end: true },
  );

  await persistSubscriptionFromStripeObject(updated);

  const refreshed = await db.Subscription.findByPk(sub.id, {
    include: [
      {
        model: db.Plan,
        as: 'plan',
        attributes: ['id', 'tierKey', 'displayName', 'limits', 'trialDays', 'priceAmountCents', 'priceCurrency'],
        required: false,
      },
    ],
  });

  return {
    alreadyScheduled: false,
    subscription: serializeSubscriptionRow(refreshed),
    message:
      'Renovação automática cancelada. Mantém acesso até ao fim do período já pago — não haverá nova cobrança no cartão.',
  };
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  listCheckoutPlans,
  getBillingStatus,
  cancelSubscriptionAtPeriodEnd,
  resetStripeClient,
};
