'use strict';

const db = require('../../Models');

function serializePublicPlan(row) {
  const plain = row.get({ plain: true });
  const cents = plain.priceAmountCents ?? plain.price_amount_cents;
  return {
    id: plain.id,
    tierKey: plain.tierKey ?? plain.tier_key,
    displayName: plain.displayName ?? plain.display_name ?? plain.name,
    limits: plain.limits && typeof plain.limits === 'object' ? plain.limits : {},
    trialDays: Number(plain.trialDays ?? plain.trial_days) || 0,
    priceAmountCents: cents != null ? Number(cents) : null,
    priceCurrency: plain.priceCurrency ?? plain.price_currency ?? 'brl',
  };
}

/** Vitrine para landing — sem dados sensíveis (sem Stripe IDs). */
async function listPublicActivePlans() {
  return db.Plan.findAll({
    where: { isActive: true, isPublic: true },
    attributes: ['id', 'tierKey', 'displayName', 'limits', 'trialDays', 'priceAmountCents', 'priceCurrency'],
    order: [
      ['priceAmountCents', 'ASC NULLS LAST'],
      ['displayName', 'ASC'],
    ],
  });
}

module.exports = {
  listPublicActivePlans,
  serializePublicPlan,
};
