'use strict';

const dashboardService = require('./dashboard.service');

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

async function overview(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const data = await dashboardService.getOverview(organizationId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function insights(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const rawCampaign = req.query.campaignId || req.query.campaign_id;
    const campaignIdTrim =
      rawCampaign != null && String(rawCampaign).trim()
        ? String(rawCampaign).trim()
        : null;

    let campaignUuid = null;
    if (campaignIdTrim) {
      assertUuid(campaignIdTrim, 'campaign_id');
      campaignUuid = campaignIdTrim;
    }

    const sortRaw = req.query.sort != null ? String(req.query.sort).toLowerCase().trim() : 'roas';
    const sort = sortRaw === 'ctr' ? 'ctr' : 'roas';

    const data = await dashboardService.getInsights(organizationId, {
      page: req.query.page,
      limit: req.query.limit,
      campaignId: campaignUuid,
      sort,
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function importedCampaigns(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const items = await dashboardService.listImportedCampaigns(organizationId);
    res.json({ items });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  overview,
  insights,
  importedCampaigns,
};
