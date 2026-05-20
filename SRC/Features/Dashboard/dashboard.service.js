'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../Models');

function clampInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

function buildDriveThumbnailUrl(googleDriveFileId) {
  const id = googleDriveFileId ? String(googleDriveFileId).trim() : '';
  if (!id) return null;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w400`;
}

function buildDriveViewUrl(googleDriveFileId) {
  const id = googleDriveFileId ? String(googleDriveFileId).trim() : '';
  if (!id) return null;
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

/**
 * KPIs consolidados por organização na série diária de ads + contagem de análises criativas.
 */
async function getOverview(organizationId) {
  const [spendAgg] = await db.sequelize.query(
    `SELECT COALESCE(SUM(spend), 0)::decimal AS total_spend
     FROM ad_performance_daily
     WHERE organization_id = :organizationId`,
    {
      replacements: { organizationId },
      type: QueryTypes.SELECT,
    },
  );

  const roasWeighted = await db.sequelize.query(
    `SELECT
       CASE WHEN SUM(spend) > 0 THEN
         (SUM(COALESCE(roas, 0) * COALESCE(spend, 0)) / SUM(spend))::decimal
       END AS weighted_roas
     FROM ad_performance_daily
     WHERE organization_id = :organizationId`,
    {
      replacements: { organizationId },
      type: QueryTypes.SELECT,
    },
  );

  const analyzed = await db.CreativeAnalysis.count({
    where: { organizationId },
  });

  return {
    totalSpend: spendAgg?.total_spend != null ? String(spendAgg.total_spend) : '0',
    globalRoasWeighted:
      roasWeighted[0]?.weighted_roas != null ? String(roasWeighted[0].weighted_roas) : null,
    creativeAnalysesCount: analyzed,
  };
}

/**
 * Última análise por anúncio + rollup de métricas diárias — ordenável por ROAS ou CTR (~cliques/impressões).
 */
async function getInsights(
  organizationId,
  {
    page = 1,
    limit = 20,
    campaignId = null,
    sort = 'roas',
  },
) {
  const lim = clampInt(limit, 20, 100);
  const pg = clampInt(page, 1, 1_000_000);
  const offset = (pg - 1) * lim;
  const sortKey = sort === 'ctr' ? 'ctr' : 'roas';

  const campaignClause = campaignId ? 'AND camp.id = :campaignId' : '';

  /** ROAS rollup em `perf` ou CTR efetivo (cliques/impressões) — expressões repetidas garantem segurança (sem interpolar entrada). */
  const orderExpr =
    sortKey === 'ctr'
      ? `(CASE WHEN COALESCE(p.impressions_sum, 0) > 0 THEN
           (p.clicks_sum::numeric / NULLIF(p.impressions_sum::numeric, 0))
         ELSE NULL END) DESC NULLS LAST, ca.analyzed_at DESC`
      : `p.roas_w DESC NULLS LAST, ca.roas DESC NULLS LAST, ca.analyzed_at DESC`;

  const countSql = `
    WITH latest_ca AS (
      SELECT DISTINCT ON (ad_id)
        id, organization_id, ad_id, media_id, analyzed_at,
        ctr, roas, spend, performance_snapshot, ai_analysis
      FROM creative_analyses
      WHERE organization_id = :organizationId
      ORDER BY ad_id, analyzed_at DESC
    )
    SELECT COUNT(*)::int AS cnt
    FROM latest_ca ca
    INNER JOIN ads ad ON ad.id = ca.ad_id AND ad.organization_id = :organizationId
    INNER JOIN ad_sets asn ON asn.id = ad.ad_set_id
    INNER JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    WHERE 1=1 ${campaignClause}
  `;

  /** @type {Array<{ cnt: number }>} */
  const countRows = await db.sequelize.query(countSql, {
    replacements:
      campaignId != null ? { organizationId, campaignId } : { organizationId },
    type: QueryTypes.SELECT,
  });

  const total = countRows[0]?.cnt ?? 0;

  const listSql = `
    WITH latest_ca AS (
      SELECT DISTINCT ON (ad_id)
        id, organization_id, ad_id, media_id, analyzed_at,
        ctr, roas, spend, performance_snapshot, ai_analysis
      FROM creative_analyses
      WHERE organization_id = :organizationId
      ORDER BY ad_id, analyzed_at DESC
    ),
    perf AS (
      SELECT
        ad_id,
        SUM(COALESCE(spend, 0))::numeric AS spend_sum,
        SUM(COALESCE(impressions, 0))::bigint AS impressions_sum,
        SUM(COALESCE(clicks, 0))::bigint AS clicks_sum,
        CASE WHEN SUM(spend) > 0 THEN
          (SUM(COALESCE(roas, 0::numeric) * COALESCE(spend, 0::numeric)) / SUM(spend))
        ELSE NULL END::numeric AS roas_w,
        AVG(COALESCE(ctr, 0::numeric)) AS ctr_daily_avg
      FROM ad_performance_daily
      WHERE organization_id = :organizationId
      GROUP BY ad_id
    )
    SELECT
      ca.id AS creative_analysis_id,
      ca.analyzed_at,
      ca.performance_snapshot,
      ca.ai_analysis,
      ca.roas AS analysis_roas,
      ca.ctr AS analysis_ctr,
      ad.id AS ad_id,
      ad.name AS ad_name,
      ad.meta_ad_id,
      ma.id AS media_id,
      ma.google_drive_file_id,
      ma.meta_video_id AS media_meta_video_id,
      ma.ingest_metadata,
      camp.id AS campaign_id,
      camp.name AS campaign_name,
      camp.meta_campaign_id,
      COALESCE(p.spend_sum, 0)::decimal AS rollup_spend,
      p.impressions_sum,
      p.clicks_sum,
      p.roas_w,
      CASE WHEN COALESCE(p.impressions_sum, 0) > 0 THEN
        (p.clicks_sum::numeric / p.impressions_sum::numeric)
      ELSE NULL END AS rollup_ctr_eff
    FROM latest_ca ca
    INNER JOIN ads ad ON ad.id = ca.ad_id AND ad.organization_id = :organizationId
    INNER JOIN ad_sets asn ON asn.id = ad.ad_set_id
    INNER JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    INNER JOIN media_assets ma ON ma.id = ca.media_id
    LEFT JOIN perf p ON p.ad_id = ad.id
    WHERE 1=1 ${campaignClause}
    ORDER BY ${orderExpr}
    LIMIT :limit OFFSET :offset
  `;

  /** @type {object[]} */
  const rows = await db.sequelize.query(listSql, {
    replacements:
      campaignId != null
        ? { organizationId, campaignId, limit: lim, offset }
        : { organizationId, limit: lim, offset },
    type: QueryTypes.SELECT,
  });

  const items = rows.map((r) => {
    const gdf = r.google_drive_file_id ? String(r.google_drive_file_id).trim() : '';

    /** @type {Record<string, unknown>} */
    const ingestMeta =
      r.ingest_metadata && typeof r.ingest_metadata === 'object' ? r.ingest_metadata : {};

    return {
      creativeAnalysisId: r.creative_analysis_id,
      adId: r.ad_id,
      adName: r.ad_name,
      metaAdId: r.meta_ad_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      metaCampaignId: r.meta_campaign_id,
      mediaId: r.media_id,
      thumbnailUrl: gdf ? buildDriveThumbnailUrl(gdf) : (ingestMeta.thumbnailUrl || null),
      driveViewUrl: gdf ? buildDriveViewUrl(gdf) : null,
      metaVideoId: r.media_meta_video_id || null,
      analyzedAt: r.analyzed_at,
      aiAnalysis: r.ai_analysis,
      performanceSnapshot: r.performance_snapshot,
      rollup: {
        spend: r.rollup_spend != null ? String(r.rollup_spend) : '0',
        impressions: r.impressions_sum != null ? String(r.impressions_sum) : '0',
        clicks: r.clicks_sum != null ? String(r.clicks_sum) : '0',
        roasWeighted: r.roas_w != null ? String(r.roas_w) : null,
        ctrEffective: r.rollup_ctr_eff != null ? String(r.rollup_ctr_eff) : null,
      },
    };
  });

  return {
    items,
    pagination: {
      page: pg,
      limit: lim,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / lim),
    },
    sortBy: sortKey,
  };
}

async function listImportedCampaigns(organizationId) {
  const rows = await db.Campaign.findAll({
    where: { organizationId },
    attributes: ['id', 'metaCampaignId', 'name'],
    include: [
      {
        model: db.MetaAdAccount,
        as: 'metaAdAccount',
        attributes: ['id', 'metaActId', 'name'],
        required: true,
      },
    ],
    order: [['name', 'ASC']],
  });

  return rows.map((r) => {
    const plain = r.get({ plain: true });
    return {
      id: plain.id,
      name: plain.name,
      metaCampaignId: plain.metaCampaignId,
      metaAccount: plain.metaAdAccount
        ? {
            id: plain.metaAdAccount.id,
            metaActId: plain.metaAdAccount.metaActId,
            name: plain.metaAdAccount.name,
          }
        : null,
    };
  });
}

module.exports = {
  getOverview,
  getInsights,
  listImportedCampaigns,
};
