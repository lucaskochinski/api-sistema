'use strict';

const Stripe = require('stripe');
const { UniqueConstraintError } = require('sequelize');
const db = require('../../Models');

let _stripe;

function stripeSecret() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k || !String(k).trim()) {
    const err = new Error('STRIPE_SECRET_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }
  return String(k).trim();
}

function webhookSecret() {
  const w = process.env.STRIPE_WEBHOOK_SECRET;
  if (!w || !String(w).trim()) {
    const err = new Error('STRIPE_WEBHOOK_SECRET_not_configured');
    err.statusCode = 503;
    throw err;
  }
  return String(w).trim();
}

function stripeClient() {
  if (!_stripe) {
    _stripe = new Stripe(stripeSecret());
  }
  return _stripe;
}

function publicBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
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

  const priceId = plan.stripePriceId ? String(plan.stripePriceId).trim() : '';
  if (!priceId) {
    const err = new Error('plan_missing_stripe_price_id');
    err.statusCode = 422;
    throw err;
  }

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

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
};
