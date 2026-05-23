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

function parseAdIds(query) {
  const raw = query.adIds ?? query.ad_ids;
  if (raw == null || raw === '') return null;

  const parts = Array.isArray(raw)
    ? raw.flatMap((entry) => String(entry).split(','))
    : String(raw).split(',');

  const ids = parts.map((part) => String(part).trim()).filter(Boolean);
  if (!ids.length) return null;

  for (const id of ids) {
    assertUuid(id, 'ad_id');
  }
  return ids;
}

async function overview(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const periodRaw = req.query.period != null ? String(req.query.period).trim() : 'today';
    const adIds = parseAdIds(req.query);
    const data = await dashboardService.getOverview(organizationId, { period: periodRaw, adIds });
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

async function insightDetails(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.adId, 'ad_id');

    const data = await dashboardService.getInsightDetails(organizationId, req.params.adId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function adMetaBreakdowns(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.adId, 'ad_id');

    const breakdown = req.query.breakdown != null ? String(req.query.breakdown).trim() : 'platform_position';
    const period = req.query.period != null ? String(req.query.period).trim() : '30d';

    const data = await dashboardService.getAdMetaBreakdowns(organizationId, req.params.adId, {
      breakdown,
      period,
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

async function getExternalSalesStats(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const { platform } = req.params;
    const VALID_PLATFORMS = ['utmify', 'pagtrust', 'lovable', 'hooko', 'vturb'];
    if (!VALID_PLATFORMS.includes(platform)) {
      const err = new Error('invalid_platform_dashboard');
      err.statusCode = 400;
      return next(err);
    }

    const db = require('../../Models');
    const metaMetrics = require('../../Services/meta_insights_metrics.service');

    const periodRaw = req.query.period != null ? String(req.query.period).trim() : '30d';
    const { since, until } = metaMetrics.resolvePeriodDates(periodRaw);

    const sales = await db.ExternalSale.findAll({
      where: {
        organizationId,
        platform,
        saleDate: {
          [db.Sequelize.Op.gte]: new Date(`${since}T00:00:00.000Z`),
          [db.Sequelize.Op.lte]: new Date(`${until}T23:59:59.999Z`),
        },
      },
      order: [['sale_date', 'ASC']],
    });

    let overviewMeta = { totalSpend: 0, metaPurchases: 0, creativeAnalyses: 0 };
    try {
      const overview = await dashboardService.getOverview(organizationId, { period: periodRaw });
      overviewMeta = {
        totalSpend: Number(overview.totalSpend || 0),
        metaPurchases: Number(overview.funnel?.purchases || 0),
        creativeAnalyses: Number(overview.creativeAnalysesCount || 0),
      };
    } catch (_overviewErr) {
      /* overview opcional para enriquecer CPA/lucro horário */
    }

    if (sales.length === 0) {
      return res.json(dashboardService.emptyExternalSalesPayload(since, until));
    }

    const aggregated = dashboardService.aggregateExternalSalesStats(sales, {
      ...overviewMeta,
      since,
      until,
    });
    return res.json({
      ...aggregated,
      dateRange: { since, until },
    });
  } catch (error) {
    next(error);
  }
}

async function triggerAdAnalysis(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.adId, 'ad_id');

    const force = Boolean(req.body?.force || req.query?.force === '1' || req.query?.force === 'true');
    const data = await dashboardService.triggerAdAnalysis(organizationId, req.params.adId, {
      force,
      actingUserProfile: {
        email: req.user.email,
        roles: Array.isArray(req.user.roles) ? req.user.roles : [],
      },
    });
    res.status(202).json({
      status: 'accepted',
      message: 'video_analysis_job_queued',
      ...data,
    });
  } catch (e) {
    next(e);
  }
}

async function refreshMedia(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.mediaId, 'media_id');

    const data = await dashboardService.refreshMediaUrl(organizationId, req.params.mediaId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function creativeFormats(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);

    const data = await dashboardService.getCreativeFormats(organizationId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function adMediaPlayback(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.adId, 'ad_id');

    const data = await dashboardService.getAdMediaPlayback(organizationId, req.params.adId);
    res.json(data);
  } catch (e) {
    next(e);
  }
}

async function linkVturbVideo(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    ensureMembershipMatches(req, organizationId);
    assertUuid(req.params.adId, 'ad_id');

    const vturbVideoId =
      req.body?.vturbVideoId != null
        ? req.body.vturbVideoId
        : req.body?.vturb_video_id != null
          ? req.body.vturb_video_id
          : '';

    const data = await dashboardService.linkVturbVideo(
      organizationId,
      req.params.adId,
      vturbVideoId,
    );
    res.json(data);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  overview,
  insights,
  insightDetails,
  adMetaBreakdowns,
  adMediaPlayback,
  importedCampaigns,
  getExternalSalesStats,
  refreshMedia,
  triggerAdAnalysis,
  creativeFormats,
  linkVturbVideo,
};
