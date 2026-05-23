'use strict';

const { ensureActiveJwtMembership } = require('../../Utils/ensure_organization_membership.util');
const metasyncService = require('./metasync.service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value, fieldName) {
  if (!value || !UUID_RE.test(String(value))) {
    const err = new Error(`invalid_${fieldName}`);
    err.statusCode = 400;
    throw err;
  }
}

/** Resolve `organizationId` quando o JWT permite várias memberships. */
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

async function listAdAccounts(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureActiveJwtMembership(req, organizationId);

    const items = await metasyncService.listAdAccounts(organizationId);
    res.json({ items });
  } catch (e) {
    next(e);
  }
}

async function listLiveCampaigns(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureActiveJwtMembership(req, organizationId);

    const items = await metasyncService.listLiveCampaigns(
      organizationId,
      req.params.metaActId,
    );

    const includeQuota =
      req.query.includeQuota === '1' || req.query.includeQuota === 'true';

    /** @type {object} */
    const body = { items };
    if (includeQuota) {
      body.quota = await metasyncService.introspectQuotaForFrontend(organizationId, {
        email: req.user.email,
        roles: Array.isArray(req.user.roles) ? req.user.roles : [],
      });
    }
    res.json(body);
  } catch (e) {
    next(e);
  }
}

async function listLiveAdsByCampaign(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureActiveJwtMembership(req, organizationId);

    const items = await metasyncService.listLiveAdsByCampaign(
      organizationId,
      req.params.metaActId,
      req.params.metaCampaignId,
    );

    const includeQuota =
      req.query.includeQuota === '1' || req.query.includeQuota === 'true';

    /** @type {object} */
    const body = { items };
    if (includeQuota) {
      body.quota = await metasyncService.introspectQuotaForFrontend(organizationId, {
        email: req.user.email,
        roles: Array.isArray(req.user.roles) ? req.user.roles : [],
      });
    }
    res.json(body);
  } catch (e) {
    next(e);
  }
}

async function importAd(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureActiveJwtMembership(req, organizationId);

    const metaActIdFromRoute = req.body?.metaActId;
    if (!metaActIdFromRoute || !String(metaActIdFromRoute).trim()) {
      const err = new Error('metaActId_required');
      err.statusCode = 400;
      throw err;
    }

    const { insightsSince, insightsUntil } = req.body || {};

    const result = await metasyncService.importAndAnalyzeAd({
      organizationId,
      metaActIdFromRoute,
      metaCampaignGraphId: req.params.metaCampaignId,
      metaAdGraphId: req.params.metaAdId,
      insightsSince,
      insightsUntil,
      actingUserProfile: {
        email: req.user.email,
        roles: Array.isArray(req.user.roles) ? req.user.roles : [],
      },
    });
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listAdAccounts,
  listLiveCampaigns,
  listLiveAdsByCampaign,
  importAd,
};
