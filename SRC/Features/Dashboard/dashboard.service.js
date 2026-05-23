'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../Models');
const metaService = require('../Meta/meta.service');
const graph = require('../../Services/meta_graph.client');
const creativeFormat = require('../../Services/creative_format.service');
const metaMetrics = require('../../Services/meta_insights_metrics.service');
const metaBreakdowns = require('../../Services/meta_insights_breakdown.service');

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

function pickThumbnailFromRawCreative(rawCreative) {
  const c = rawCreative && typeof rawCreative === 'object' ? rawCreative : {};
  if (c.thumbnail_url) return String(c.thumbnail_url);
  if (c.image_url) return String(c.image_url);
  const spec = c.object_story_spec;
  if (spec && typeof spec === 'object') {
    if (spec.link_data?.picture) return String(spec.link_data.picture);
    if (spec.video_data?.image_url) return String(spec.video_data.image_url);
  }
  return null;
}

function graphPayloadHasError(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.error);
}

/**
 * KPIs consolidados por organização na série diária de ads + contagem de análises criativas.
 */
async function getOverview(organizationId, { period = 'today' } = {}) {
  const { since, until, period: resolvedPeriod } = metaMetrics.resolvePeriodDates(period);

  const [spendAgg] = await db.sequelize.query(
    `SELECT COALESCE(SUM(apd.spend), 0)::decimal AS total_spend
     FROM ad_performance_daily apd
     INNER JOIN ads a ON a.id = apd.ad_id
     WHERE apd.organization_id = :organizationId
       AND apd.snapshot_date >= :since
       AND apd.snapshot_date <= :until`,
    {
      replacements: { organizationId, since, until },
      type: QueryTypes.SELECT,
    },
  );

  const roasWeighted = await db.sequelize.query(
    `SELECT
       CASE WHEN SUM(apd.spend) > 0 THEN
         (SUM(COALESCE(apd.roas, 0) * COALESCE(apd.spend, 0)) / SUM(apd.spend))::decimal
       END AS weighted_roas
     FROM ad_performance_daily apd
     INNER JOIN ads a ON a.id = apd.ad_id
     WHERE apd.organization_id = :organizationId
       AND apd.snapshot_date >= :since
       AND apd.snapshot_date <= :until`,
    {
      replacements: { organizationId, since, until },
      type: QueryTypes.SELECT,
    },
  );

  const analyzed = await db.CreativeAnalysis.count({
    where: { organizationId },
  });

  const perfRows = await db.AdPerformanceDaily.findAll({
    where: {
      organizationId,
      snapshotDate: {
        [db.Sequelize.Op.gte]: since,
        [db.Sequelize.Op.lte]: until,
      },
    },
    include: [{ model: db.Ad, as: 'ad', required: true }],
  });

  const aggregated = metaMetrics.aggregateDailyMetrics(perfRows);

  const adMap = new Map();
  const dailyMap = new Map();

  for (const row of perfRows) {
    const extracted = metaMetrics.extractDailyMetrics(row.metricsJsonb);
    const clicks = Number(row.clicks || 0);
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const roas = Number(row.roas || 0);

    const dateKey = row.snapshotDate;
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        date: dateKey,
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        roasWeighted: 0,
        roasSpend: 0,
      });
    }
    const daily = dailyMap.get(dateKey);
    daily.spend += spend;
    daily.impressions += impressions;
    daily.clicks += clicks;
    daily.reach += extracted.reach;
    daily.roasWeighted += roas * spend;
    daily.roasSpend += spend;

    if (!row.adId) continue;
    if (!adMap.has(row.adId)) {
      adMap.set(row.adId, {
        name: row.ad?.name || 'Anúncio ' + row.adId.slice(0, 4),
        spend: 0,
        impressions: 0,
        clicks: 0,
        pageViews: 0,
        initiateCheckouts: 0,
        addToCart: 0,
        purchases: 0,
        video3s: 0,
        video75: 0,
        videoPlays: 0,
        roasWeighted: 0,
        roasSpend: 0,
      });
    }
    const adData = adMap.get(row.adId);
    adData.spend += spend;
    adData.impressions += impressions;
    adData.clicks += clicks;
    adData.pageViews += extracted.pageViews;
    adData.initiateCheckouts += extracted.initiateCheckouts;
    adData.addToCart += extracted.addToCart;
    adData.purchases += extracted.purchases;
    adData.video3s += extracted.video3s;
    adData.video75 += extracted.video75;
    adData.videoPlays += extracted.videoPlays;
    adData.roasWeighted += roas * spend;
    adData.roasSpend += spend;
  }

  const adList = Array.from(adMap.values());

  const getBest = (list, scoreFn, ascending = false) => {
    if (!list.length) return null;
    const sorted = [...list]
      .map((item) => ({ item, score: scoreFn(item) }))
      .filter((x) => x.score !== null && Number.isFinite(x.score) && x.score > 0);

    if (!sorted.length) return null;
    sorted.sort((a, b) => (ascending ? a.score - b.score : b.score - a.score));
    return sorted[0];
  };

  const bestHook = getBest(adList, (ad) =>
    ad.impressions > 0 ? (ad.video3s / ad.impressions) * 100 : 0,
  );
  const bestRetention = getBest(adList, (ad) =>
    ad.videoPlays > 0 ? (ad.video75 / ad.videoPlays) * 100 : 0,
  );
  const bestCtr = getBest(adList, (ad) =>
    ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
  );
  const bestCostIc = getBest(
    adList,
    (ad) => (ad.initiateCheckouts > 0 ? ad.spend / ad.initiateCheckouts : null),
    true,
  );
  const bestRoas = getBest(adList, (ad) =>
    ad.roasSpend > 0 ? ad.roasWeighted / ad.roasSpend : 0,
  );
  const bestSalesVolume = getBest(adList, (ad) => ad.purchases);
  const bestConversionRate = getBest(adList, (ad) =>
    ad.pageViews > 0 ? (ad.purchases / ad.pageViews) * 100 : 0,
  );

  const dailyMeta = Array.from(dailyMap.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((d) => ({
      date: d.date,
      label: metaMetrics.formatDailyLabel(d.date),
      spend: Math.round(d.spend * 100) / 100,
      impressions: d.impressions,
      clicks: d.clicks,
      reach: d.reach,
      roas: d.roasSpend > 0 ? Math.round((d.roasWeighted / d.roasSpend) * 100) / 100 : 0,
      ctr: d.impressions > 0 ? Math.round((d.clicks / d.impressions) * 10000) / 100 : 0,
    }));

  return {
    period: resolvedPeriod,
    dateRange: { since, until },
    totalSpend: spendAgg?.total_spend != null ? String(spendAgg.total_spend) : '0',
    globalRoasWeighted:
      roasWeighted[0]?.weighted_roas != null ? String(roasWeighted[0].weighted_roas) : null,
    creativeAnalysesCount: analyzed,
    delivery: aggregated.delivery,
    funnel: {
      impressions: aggregated.delivery.impressions,
      cliques: aggregated.delivery.clicks,
      ...aggregated.funnel,
    },
    videoMetrics: aggregated.video,
    videoRetention: aggregated.videoRetention,
    videoPlayCurve: aggregated.videoPlayCurve,
    creativeHealth: aggregated.creativeHealth,
    dailyMeta,
    rankings: {
      bestHook: bestHook
        ? `${bestHook.item.name} (${bestHook.score.toFixed(1)}%)`
        : 'Sem dados',
      bestRetention: bestRetention
        ? `${bestRetention.item.name} (${bestRetention.score.toFixed(1)}%)`
        : 'Sem dados',
      bestCtr: bestCtr ? `${bestCtr.item.name} (${bestCtr.score.toFixed(1)}%)` : 'Sem dados',
      bestCostIc: bestCostIc
        ? `${bestCostIc.item.name} (R$ ${bestCostIc.score.toFixed(2)})`
        : 'Sem dados',
      bestRoas: bestRoas
        ? `${bestRoas.item.name} (${bestRoas.score.toFixed(2)} ROAS)`
        : 'Sem dados',
      bestSalesVolume: bestSalesVolume
        ? `${bestSalesVolume.item.name} (${bestSalesVolume.score} vendas)`
        : 'Sem dados',
      bestConversionRate: bestConversionRate
        ? `${bestConversionRate.item.name} (${bestConversionRate.score.toFixed(1)}%)`
        : 'Sem dados',
    },
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
    SELECT COUNT(*)::int AS cnt
    FROM ads ad
    LEFT JOIN ad_sets asn ON asn.id = ad.ad_set_id
    LEFT JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    WHERE ad.organization_id = :organizationId ${campaignClause}
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
      COALESCE(ca.id, ad.id) AS creative_analysis_id,
      ca.analyzed_at,
      ca.performance_snapshot,
      ca.ai_analysis,
      ca.roas AS analysis_roas,
      ca.ctr AS analysis_ctr,
      ad.id AS ad_id,
      ad.name AS ad_name,
      ad.meta_ad_id,
      ad.raw_creative_data,
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
    FROM ads ad
    LEFT JOIN ad_sets asn ON asn.id = ad.ad_set_id
    LEFT JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    LEFT JOIN latest_ca ca ON ca.ad_id = ad.id
    LEFT JOIN media_assets ma ON ma.id = ca.media_id
    LEFT JOIN perf p ON p.ad_id = ad.id
    WHERE ad.organization_id = :organizationId ${campaignClause}
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
    const rawCreative =
      r.raw_creative_data && typeof r.raw_creative_data === 'object' ? r.raw_creative_data : {};

    const thumbnailUrl = gdf
      ? buildDriveThumbnailUrl(gdf)
      : ingestMeta.thumbnailUrl ||
        pickThumbnailFromRawCreative(rawCreative) ||
        null;

    return {
      creativeAnalysisId: r.creative_analysis_id,
      adId: r.ad_id,
      adName: r.ad_name,
      metaAdId: r.meta_ad_id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      metaCampaignId: r.meta_campaign_id,
      mediaId: r.media_id,
      thumbnailUrl,
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

async function refreshMediaUrl(organizationId, mediaId) {
  const analysis = await db.CreativeAnalysis.findOne({
    where: { organizationId, mediaId },
    include: [{ model: db.MediaAsset, as: 'media' }],
  });

  let media = analysis?.media || null;
  if (!media) {
    const claim = await db.OrganizationMediaClaim.findOne({
      where: { organizationId, mediaId },
      include: [{ model: db.MediaAsset, as: 'mediaAsset' }],
    });
    media = claim?.mediaAsset || null;
  }

  if (!media) {
    const err = new Error('media_not_found');
    err.statusCode = 404;
    throw err;
  }

  if (!media.metaVideoId && (!media.ingestMetadata || !media.ingestMetadata.metaAdGraphId)) {
    const err = new Error('no_meta_reference_for_refresh');
    err.statusCode = 400;
    throw err;
  }

  const { accessToken } = await metaService.getValidToken(organizationId);

  if (media.metaVideoId) {
    const vhead = await graph.fbGet(accessToken, String(media.metaVideoId), {
      fields: 'source,picture',
    });
    if (graphPayloadHasError(vhead)) {
      const err = new Error(vhead.error.message || 'meta_video_lookup_failed');
      err.statusCode = 502;
      throw err;
    }
    if (vhead?.source) {
      const nextMeta = {
        ...(media.ingestMetadata && typeof media.ingestMetadata === 'object'
          ? media.ingestMetadata
          : {}),
        thumbnailUrl: vhead.picture || media.ingestMetadata?.thumbnailUrl || null,
        lastRefreshedAt: new Date().toISOString(),
      };
      await media.update({ ingestMetadata: nextMeta });

      return {
        type: 'video',
        url: vhead.source,
        thumbnailUrl: vhead.picture || nextMeta.thumbnailUrl || null,
      };
    }
  }

  if (media.ingestMetadata?.metaAdGraphId) {
    const adGraphId = media.ingestMetadata.metaAdGraphId;
    const adData = await graph.fbGet(accessToken, String(adGraphId), {
      fields: 'creative{image_url,thumbnail_url,video_id}',
    });
    if (graphPayloadHasError(adData)) {
      const err = new Error(adData.error.message || 'meta_ad_lookup_failed');
      err.statusCode = 502;
      throw err;
    }

    const creative = adData.creative || {};
    const thumbnailUrl = creative.thumbnail_url || creative.image_url || null;

    if (creative.video_id) {
      const vhead = await graph.fbGet(accessToken, String(creative.video_id), {
        fields: 'source,picture',
      });
      if (!graphPayloadHasError(vhead) && vhead?.source) {
        return {
          type: 'video',
          url: vhead.source,
          thumbnailUrl: vhead.picture || thumbnailUrl,
        };
      }
    }

    return {
      type: 'image',
      url: creative.image_url || thumbnailUrl,
      thumbnailUrl,
    };
  }

  return { type: 'unknown', url: null, thumbnailUrl: null };
}

async function getInsightDetails(organizationId, adId) {
  const sql = `
    WITH latest_ca AS (
      SELECT DISTINCT ON (ad_id)
        id, ad_id, media_id, ai_analysis, performance_snapshot
      FROM creative_analyses
      WHERE organization_id = :organizationId
      ORDER BY ad_id, analyzed_at DESC
    )
    SELECT
      ad.id AS ad_id,
      ad.name AS ad_name,
      ad.meta_ad_id,
      ad.meta_video_id AS ad_meta_video_id,
      ad.raw_creative_data,
      ca.id AS creative_analysis_id,
      ca.ai_analysis,
      ca.performance_snapshot,
      ma.id AS media_id,
      ma.meta_video_id,
      ma.google_drive_file_id,
      ma.ingest_metadata
    FROM ads ad
    LEFT JOIN latest_ca ca ON ca.ad_id = ad.id
    LEFT JOIN media_assets ma ON ma.id = ca.media_id
    WHERE ad.organization_id = :organizationId AND ad.id = :adId
  `;

  const rows = await db.sequelize.query(sql, {
    replacements: { organizationId, adId },
    type: db.sequelize.QueryTypes.SELECT,
  });

  if (!rows || rows.length === 0) {
    const err = new Error('Ad not found');
    err.statusCode = 404;
    throw err;
  }

  const r = rows[0];

  const perfRows = await db.AdPerformanceDaily.findAll({
    where: { organizationId, adId },
    order: [['snapshotDate', 'ASC']],
  });

  const performance_daily = perfRows.map((p) => {
    const extracted = metaMetrics.extractDailyMetrics(p.metricsJsonb);

    return {
      date: p.snapshotDate,
      label: metaMetrics.formatDailyLabel(p.snapshotDate),
      spend: Number(p.spend || 0),
      roas: Number(p.roas || 0),
      ctr: Number(p.ctr || 0),
      impressions: Number(p.impressions || 0),
      clicks: Number(p.clicks || 0),
      reach: extracted.reach,
      frequency: extracted.frequency,
      inlineLinkClicks: extracted.inlineLinkClicks,
      video: {
        plays: extracted.videoPlays,
        watched2s: extracted.video2s,
        watched3s: extracted.video3s,
        watched6s: extracted.video6s,
        watched15s: extracted.video15s,
        watched25: extracted.video25,
        watched50: extracted.video50,
        watched75: extracted.video75,
        watched95: extracted.video95,
        watched100: extracted.video100,
        watched30s: extracted.video30s,
        thruplay: extracted.videoThruplay,
        avgWatchTimeSec: extracted.videoAvgTime,
      },
    };
  });

  const metaAggregated = metaMetrics.aggregateDailyMetrics(perfRows);

  const rawCreative = r.raw_creative_data && typeof r.raw_creative_data === 'object' ? r.raw_creative_data : {};
  
  let primaryText = '';
  let headline = '';
  let ctaType = '';

  if (rawCreative.object_story_spec) {
    const linkData = rawCreative.object_story_spec.link_data || {};
    const videoData = rawCreative.object_story_spec.video_data || {};
    primaryText = linkData.message || videoData.message || rawCreative.body || '';
    headline = linkData.name || videoData.title || rawCreative.title || '';
    ctaType = linkData.call_to_action?.type || videoData.call_to_action?.type || rawCreative.call_to_action_type || '';
  } else if (rawCreative.asset_feed_spec) {
    const texts = rawCreative.asset_feed_spec.bodies || [];
    const titles = rawCreative.asset_feed_spec.titles || [];
    const ctas = rawCreative.asset_feed_spec.call_to_action_types || [];
    if (texts.length > 0) primaryText = texts[0].text || '';
    if (titles.length > 0) headline = titles[0].text || '';
    if (ctas.length > 0) ctaType = ctas[0] || '';
  }

  if (!primaryText) primaryText = rawCreative.body || '';
  if (!headline) headline = rawCreative.title || r.ad_name;
  if (!ctaType) ctaType = rawCreative.call_to_action_type || 'LEARN_MORE';

  let mediaId = r.media_id || null;
  let metaVideoId = r.meta_video_id || r.ad_meta_video_id || null;

  if (!mediaId && metaVideoId) {
    const mediaRow = await db.MediaAsset.findOne({ where: { metaVideoId } });
    if (mediaRow) {
      mediaId = mediaRow.id;
      metaVideoId = mediaRow.metaVideoId;
    }
  }

  const ingestMeta = r.ingest_metadata && typeof r.ingest_metadata === 'object' ? r.ingest_metadata : {};
  const googleDriveFileId = r.google_drive_file_id
    ? String(r.google_drive_file_id).trim()
    : '';

  let thumbnailUrl = '/imagens/meta.png';
  if (googleDriveFileId) {
    thumbnailUrl = buildDriveThumbnailUrl(googleDriveFileId);
  } else if (ingestMeta.thumbnailUrl) {
    thumbnailUrl = ingestMeta.thumbnailUrl;
  } else if (rawCreative.thumbnail_url || rawCreative.image_url) {
    thumbnailUrl = rawCreative.thumbnail_url || rawCreative.image_url;
  }

  let mediaUrl = null;
  let mediaType = 'unknown';

  if (googleDriveFileId) {
    mediaUrl = buildDriveViewUrl(googleDriveFileId);
    mediaType = 'drive';
  } else if (mediaId) {
    try {
      const refreshed = await refreshMediaUrl(organizationId, mediaId);
      if (refreshed.url) {
        mediaUrl = refreshed.url;
        mediaType = refreshed.type || 'video';
      }
      if (refreshed.thumbnailUrl) {
        thumbnailUrl = refreshed.thumbnailUrl;
      }
    } catch (refreshErr) {
      console.warn('[dashboard] insight media refresh fallback', refreshErr.message);
      mediaUrl = thumbnailUrl;
      mediaType = metaVideoId ? 'video' : 'image';
    }
  } else {
    mediaUrl = thumbnailUrl;
    mediaType = metaVideoId ? 'video' : 'image';
  }

  return {
    id: r.ad_id,
    meta_ad_id: r.meta_ad_id,
    name: r.ad_name,
    primary_text: primaryText,
    headline: headline,
    cta_type: ctaType,
    creative_meta: {
      object_type: rawCreative.object_type || null,
      link_url: rawCreative.link_url || null,
      is_dynamic: Boolean(rawCreative.asset_feed_spec),
      instagram_permalink_url: rawCreative.instagram_permalink_url || null,
    },
    media_id: mediaId,
    meta_video_id: metaVideoId,
    thumbnail_url: thumbnailUrl,
    media_type: mediaType,
    media_url: mediaUrl,
    performance_snapshot: r.performance_snapshot || { roas: 0, ctr: 0, spend: 0 },
    performance_daily,
    delivery: metaAggregated.delivery,
    funnel: metaAggregated.funnel,
    video_retention: metaAggregated.videoRetention,
    video_metrics: metaAggregated.video,
    video_play_curve: metaAggregated.videoPlayCurve,
    creative_health: metaAggregated.creativeHealth,
    ai_analysis: r.ai_analysis || null,
  };
}

async function getAdMetaBreakdowns(organizationId, adId, { breakdown, period = '30d' } = {}) {
  const adRow = await db.Ad.findOne({ where: { id: adId, organizationId } });
  if (!adRow) {
    const err = new Error('Ad not found');
    err.statusCode = 404;
    throw err;
  }
  if (!adRow.metaAdId) {
    const err = new Error('ad_missing_meta_id');
    err.statusCode = 400;
    throw err;
  }

  return metaBreakdowns.fetchAdBreakdowns(organizationId, adRow.metaAdId, { breakdown, period });
}

/**
 * Distribuição de formatos (9:16, 1:1, etc.) dos criativos importados da org.
 */
async function getCreativeFormats(organizationId) {
  const rows = await db.sequelize.query(
    `SELECT
      ad.id AS ad_id,
      ad.name AS ad_name,
      ad.raw_creative_data,
      ad.is_dynamic_creative,
      camp.name AS campaign_name,
      ma.ingest_metadata
    FROM ads ad
    LEFT JOIN ad_sets asn ON asn.id = ad.ad_set_id
    LEFT JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    LEFT JOIN media_assets ma ON ma.meta_video_id = ad.meta_video_id
    WHERE ad.organization_id = :organizationId
    ORDER BY ad.name ASC`,
    {
      replacements: { organizationId },
      type: QueryTypes.SELECT,
    },
  );

  return creativeFormat.buildFormatsDistribution(rows);
}

module.exports = {
  getOverview,
  getInsights,
  getInsightDetails,
  getAdMetaBreakdowns,
  listImportedCampaigns,
  refreshMediaUrl,
  getCreativeFormats,
};
