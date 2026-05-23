'use strict';

const Stripe = require('stripe');

let _stripe;

function stripeClient() {
  if (!_stripe) {
    const k = process.env.STRIPE_SECRET_KEY;
    if (!k || !String(k).trim()) {
      const err = new Error('STRIPE_SECRET_KEY_not_configured');
      err.statusCode = 503;
      throw err;
    }
    _stripe = new Stripe(String(k).trim());
  }
  return _stripe;
}

function lookupKeyForTier(tierKey, interval = 'month') {
  return `hooko_${String(tierKey).trim().toLowerCase()}_${interval}`;
}

async function findPriceByLookupKey(lookupKey) {
  const stripe = stripeClient();
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    expand: ['data.product'],
    limit: 1,
  });
  return existing.data[0] || null;
}

/**
 * Garante Product + Price recorrente no Stripe (idempotente via lookup_key).
 * @param {{ displayName: string, tierKey: string, amountCents: number, currency?: string, interval?: string }} opts
 */
async function ensureStripePlan({
  displayName,
  tierKey,
  amountCents,
  currency = 'brl',
  interval = 'month',
}) {
  const stripe = stripeClient();
  const lookupKey = lookupKeyForTier(tierKey, interval);
  const normalizedAmount = Math.max(0, Math.floor(Number(amountCents) || 0));
  const normalizedCurrency = String(currency || 'brl').trim().toLowerCase();

  if (!displayName || !tierKey) {
    const err = new Error('stripe_plan_identity_required');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount < 50) {
    const err = new Error('plan_price_amount_invalid');
    err.statusCode = 400;
    throw err;
  }

  const existing = await findPriceByLookupKey(lookupKey);

  if (existing) {
    const productId =
      typeof existing.product === 'string' ? existing.product : existing.product?.id;

    if (productId) {
      await stripe.products.update(productId, {
        name: displayName,
        metadata: { plan_slug: tierKey, tier_key: tierKey },
      });
    }

    if (
      existing.unit_amount === normalizedAmount &&
      String(existing.currency).toLowerCase() === normalizedCurrency &&
      existing.active
    ) {
      return {
        priceId: existing.id,
        productId,
        lookupKey,
        amountCents: existing.unit_amount,
        currency: existing.currency,
      };
    }

    const newPrice = await stripe.prices.create({
      product: productId,
      currency: normalizedCurrency,
      unit_amount: normalizedAmount,
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      metadata: { tier_key: tierKey },
    });

    return {
      priceId: newPrice.id,
      productId,
      lookupKey,
      amountCents: normalizedAmount,
      currency: normalizedCurrency,
    };
  }

  const price = await stripe.prices.create({
    currency: normalizedCurrency,
    unit_amount: normalizedAmount,
    recurring: { interval },
    lookup_key: lookupKey,
    product_data: {
      name: displayName,
      metadata: { plan_slug: tierKey, tier_key: tierKey },
    },
    metadata: { tier_key: tierKey },
  });

  const productId = typeof price.product === 'string' ? price.product : price.product?.id;

  return {
    priceId: price.id,
    productId,
    lookupKey,
    amountCents: normalizedAmount,
    currency: normalizedCurrency,
  };
}

/** Actualiza só o nome do produto Stripe (sem alterar preço). */
async function syncStripeProductName({ stripeProductId, displayName, tierKey }) {
  if (!stripeProductId) return;
  const stripe = stripeClient();
  await stripe.products.update(String(stripeProductId), {
    name: displayName,
    metadata: { plan_slug: tierKey, tier_key: tierKey },
  });
}

module.exports = {
  ensureStripePlan,
  syncStripeProductName,
  lookupKeyForTier,
  stripeClient,
};
