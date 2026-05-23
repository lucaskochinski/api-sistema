'use strict';

const subscriptionsService = require('../services/admin.subscriptions.service');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function getBillingContext(req, res, next) {
  try {
    const { organizationId } = req.params;
    adminAudit(req.user?.userId, 'admin.subscriptions.context', { organizationId });
    const ctx = await subscriptionsService.getOrganizationBillingContext(organizationId);
    res.json(ctx);
  } catch (e) {
    next(e);
  }
}

async function grantPlan(req, res, next) {
  try {
    const { organizationId } = req.params;
    const body = req.body || {};
    adminAudit(req.user?.userId, 'admin.subscriptions.grant', {
      organizationId,
      planId: body.planId ?? body.plan_id,
      mode: body.mode,
    });
    const out = await subscriptionsService.grantOrganizationPlan({
      organizationId,
      planId: body.planId ?? body.plan_id,
      grantedByUserId: req.user?.userId,
      mode: body.mode,
      status: body.status,
      periodDays: body.periodDays ?? body.period_days,
      periodEnd: body.periodEnd ?? body.period_end,
      trialDays: body.trialDays ?? body.trial_days,
      trialEndsAt: body.trialEndsAt ?? body.trial_ends_at,
      notes: body.notes ?? body.note,
      replaceExisting: body.replaceExisting ?? body.replace_existing ?? true,
    });
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
}

async function createCheckoutLink(req, res, next) {
  try {
    const { organizationId } = req.params;
    const body = req.body || {};
    adminAudit(req.user?.userId, 'admin.subscriptions.checkout', {
      organizationId,
      planId: body.planId ?? body.plan_id,
    });
    const out = await subscriptionsService.createAdminCheckoutLink({
      organizationId,
      planId: body.planId ?? body.plan_id,
      billingEmail: body.billingEmail ?? body.billing_email ?? body.email,
      billingName: body.billingName ?? body.billing_name ?? body.name,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function updateSubscription(req, res, next) {
  try {
    const { organizationId, subscriptionId } = req.params;
    const body = req.body || {};
    adminAudit(req.user?.userId, 'admin.subscriptions.update', {
      organizationId,
      subscriptionId,
    });
    const out = await subscriptionsService.updateOrganizationSubscription({
      organizationId,
      subscriptionId,
      planId: body.planId ?? body.plan_id,
      status: body.status,
      periodEnd: body.periodEnd ?? body.period_end,
      trialEndsAt: body.trialEndsAt ?? body.trial_ends_at,
      notes: body.notes ?? body.note,
      actorUserId: req.user?.userId,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function revokeSubscription(req, res, next) {
  try {
    const { organizationId, subscriptionId } = req.params;
    const body = req.body || {};
    adminAudit(req.user?.userId, 'admin.subscriptions.revoke', {
      organizationId,
      subscriptionId,
    });
    const out = await subscriptionsService.revokeOrganizationSubscription({
      organizationId,
      subscriptionId,
      reason: body.reason ?? body.notes,
      actorUserId: req.user?.userId,
      cancelStripe: body.cancelStripe ?? body.cancel_stripe ?? true,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getBillingContext,
  grantPlan,
  createCheckoutLink,
  updateSubscription,
  revokeSubscription,
};
