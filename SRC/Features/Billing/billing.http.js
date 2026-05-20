'use strict';

const billingService = require('./billing.service');

/** Registrado em `App.js` com `express.raw({ type: 'application/json' })` para assinatura Stripe. */
async function stripeWebhook(req, res, next) {
  try {
    const sig = req.headers['stripe-signature'];
    const out = await billingService.handleStripeWebhook(sig, req.body);
    res.json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  stripeWebhook,
};
