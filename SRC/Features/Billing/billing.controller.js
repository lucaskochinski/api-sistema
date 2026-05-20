'use strict';

const billingService = require('./billing.service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, fieldName) {
  if (!value || !UUID_RE.test(String(value))) {
    const err = new Error(`invalid_${fieldName}`);
    err.statusCode = 400;
    throw err;
  }
}

function resolveOrganizationId(req) {
  const fromQuery =
    req.query.organizationId != null ? String(req.query.organizationId).trim() : '';
  const fromBody =
    req.body && req.body.organizationId != null ? String(req.body.organizationId).trim() : '';

  const explicit = fromQuery || fromBody;
  if (explicit) {
    assertUuid(explicit, 'organization_id');
    return explicit;
  }

  const memberships = req.user?.memberships || [];
  if (memberships.length === 1) {
    return memberships[0].organizationId;
  }

  const err = new Error('organization_id_required');
  err.statusCode = 400;
  throw err;
}

function ensureMembershipMatches(req, organizationId) {
  const memberships = req.user?.memberships || [];
  const ok = memberships.some(
    (m) =>
      m.organizationId === organizationId &&
      (m.status === 'active' || m.status == null),
  );
  if (!ok) {
    const err = new Error('organization_not_in_membership');
    err.statusCode = 403;
    throw err;
  }
}

async function checkout(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const planIdRaw = req.body?.planId;
    if (!planIdRaw || !UUID_RE.test(String(planIdRaw))) {
      const err = new Error('invalid_plan_id');
      err.statusCode = 400;
      throw err;
    }

    const billingEmail =
      req.body?.billingEmail != null ? String(req.body.billingEmail).trim() : '';
    const billingName =
      req.body?.billingName != null ? String(req.body.billingName).trim() : '';

    const sess = await billingService.createCheckoutSession({
      organizationId,
      planId: String(planIdRaw),
      billingEmail,
      billingName,
    });

    res.status(200).json(sess);
  } catch (e) {
    next(e);
  }
}

async function portal(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const returnUrl =
      req.body?.returnUrl != null ? String(req.body.returnUrl).trim() : '';

    const out = await billingService.createPortalSession({
      organizationId,
      returnUrl: returnUrl.length ? returnUrl : null,
    });

    res.status(200).json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  checkout,
  portal,
};
