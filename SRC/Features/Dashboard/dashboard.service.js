'use strict';

const { QueryTypes } = require('sequelize');
const db = require('../../Models');
const creativeFormat = require('../../Services/creative_format.service');
const metaMetrics = require('../../Services/meta_insights_metrics.service');
const metaBreakdowns = require('../../Services/meta_insights_breakdown.service');
const metaVideoPlayback = require('../../Services/meta_video_playback.service');
const metaMarketingFull = require('../../Services/meta_marketing_full.service');
const aiCreativeUi = require('../../Services/ai_creative_ui.service');
const metaThumbnail = require('../../Services/meta_thumbnail.service');
const metaService = require('../Meta/meta.service');
const graph = require('../../Services/meta_graph.client');

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
  return metaThumbnail.pickThumbnailFromCreative(rawCreative);
}

async function enrichThumbnailUrlsForRows(organizationId, rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  let accessToken = null;
  /** @type {Map<string, string>} */
  const videoThumbCache = new Map();

  const resolveForRow = async (row) => {
    const gdf = row.google_drive_file_id ? String(row.google_drive_file_id).trim() : '';
    if (gdf) return buildDriveThumbnailUrl(gdf);

    const ingestMeta =
      row.ingest_metadata && typeof row.ingest_metadata === 'object'
        ? row.ingest_metadata
        : {};
    const rawCreative =
      row.raw_creative_data && typeof row.raw_creative_data === 'object'
        ? row.raw_creative_data
        : {};

    const storedThumb = ingestMeta.thumbnailUrl
      ? String(ingestMeta.thumbnailUrl)
      : null;
    const creativeThumb = pickThumbnailFromRawCreative(rawCreative);
    let thumbnailUrl = storedThumb || creativeThumb || null;

    const metaVideoId =
      row.media_meta_video_id ||
      row.meta_video_id ||
      metaThumbnail.extractVideoIdFromCreative(rawCreative);

    const needsUpgrade =
      metaVideoId &&
      (!thumbnailUrl || metaThumbnail.looksLikeLowResMetaThumb(thumbnailUrl));

    if (!needsUpgrade) {
      if (
        creativeThumb &&
        metaThumbnail.shouldUpgradeStoredThumbnail(thumbnailUrl, creativeThumb)
      ) {
        thumbnailUrl = creativeThumb;
      }
      return thumbnailUrl;
    }

    if (!accessToken) {
      try {
        const tokenRow = await metaService.getValidToken(organizationId);
        accessToken = tokenRow?.accessToken || null;
      } catch (_) {
        accessToken = null;
      }
    }
    if (!accessToken) return thumbnailUrl;

    const cacheKey = String(metaVideoId);
    if (videoThumbCache.has(cacheKey)) {
      const cached = videoThumbCache.get(cacheKey);
      return metaThumbnail.pickBestUrlByResolution(
        [thumbnailUrl, cached].filter(Boolean),
      );
    }

    const fromVideo = await metaThumbnail.fetchVideoThumbnailUrl(
      accessToken,
      cacheKey,
      graph,
    );
    if (fromVideo) videoThumbCache.set(cacheKey, fromVideo);

    return metaThumbnail.pickBestUrlByResolution(
      [thumbnailUrl, creativeThumb, fromVideo].filter(Boolean),
    );
  };

  return Promise.all(rows.map(resolveForRow));
}

function applyPlaybackToMedia(playback, { isVideoAd, thumbnailUrl }) {
  if (!playback) {
    return {
      mediaUrl: isVideoAd ? null : thumbnailUrl,
      mediaType: isVideoAd ? 'video' : 'image',
      embedUrl: null,
      thumbnailUrl,
    };
  }

  if (playback.url && playback.type === 'video') {
    return {
      mediaUrl: playback.url,
      mediaType: 'video',
      embedUrl: playback.embedUrl || null,
      thumbnailUrl: playback.thumbnailUrl || thumbnailUrl,
      playbackStrategy: playback.strategy || null,
    };
  }

  if (playback.type === 'image' && !isVideoAd && playback.url) {
    return {
      mediaUrl: playback.url,
      mediaType: 'image',
      embedUrl: null,
      thumbnailUrl: playback.thumbnailUrl || thumbnailUrl,
    };
  }

  if (playback.type === 'embed' && playback.embedUrl) {
    return {
      mediaUrl: null,
      mediaType: 'embed',
      embedUrl: playback.embedUrl,
      thumbnailUrl: playback.thumbnailUrl || thumbnailUrl,
      playbackUnavailable: Boolean(playback.unavailable),
      playbackReason: playback.reason || 'video_source_instagram_only',
      playbackStrategy: playback.strategy || null,
    };
  }

  return {
    mediaUrl: isVideoAd ? null : playback.thumbnailUrl || thumbnailUrl,
    mediaType: isVideoAd ? 'video' : 'image',
    embedUrl: playback.embedUrl || null,
    thumbnailUrl: playback.thumbnailUrl || thumbnailUrl,
    playbackUnavailable: Boolean(playback.unavailable),
    playbackReason: playback.reason || null,
    playbackStrategy: playback.strategy || null,
  };
}

async function loadAdMediaContext(organizationId, { metaVideoId, metaAdGraphId, rawCreative } = {}) {
  if (rawCreative && metaAdGraphId) {
    return { metaAdGraphId, rawCreative };
  }

  const where = { organizationId };
  if (metaAdGraphId) where.metaAdId = String(metaAdGraphId);
  else if (metaVideoId) where.metaVideoId = String(metaVideoId);
  else return { metaAdGraphId: metaAdGraphId || null, rawCreative: rawCreative || null };

  const ad = await db.Ad.findOne({
    where,
    attributes: ['metaAdId', 'rawCreativeData', 'metaVideoId'],
    order: [['updatedAt', 'DESC']],
  });

  if (!ad) {
    return {
      metaAdGraphId: metaAdGraphId || null,
      rawCreative: rawCreative || null,
    };
  }

  const storedCreative =
    ad.rawCreativeData && typeof ad.rawCreativeData === 'object' ? ad.rawCreativeData : null;

  return {
    metaAdGraphId: metaAdGraphId || ad.metaAdId || null,
    rawCreative: rawCreative || storedCreative,
    metaVideoId: metaVideoId || ad.metaVideoId || null,
  };
}

async function resolveInsightMediaPlayback(
  organizationId,
  { mediaId, metaVideoId, metaAdGraphId, rawCreative, isVideoAd, thumbnailUrl },
) {
  const adContext = await loadAdMediaContext(organizationId, {
    metaVideoId,
    metaAdGraphId,
    rawCreative,
  });

  let playback = await metaVideoPlayback.fetchMetaVideoPlayback(organizationId, {
    metaVideoId: adContext.metaVideoId || metaVideoId,
    metaAdGraphId: adContext.metaAdGraphId || metaAdGraphId,
    rawCreative: adContext.rawCreative || rawCreative,
  });

  if (!playback?.url && mediaId) {
    try {
      const refreshed = await refreshMediaUrl(organizationId, mediaId, {
        metaAdGraphId: adContext.metaAdGraphId || metaAdGraphId,
        rawCreative: adContext.rawCreative || rawCreative,
      });
      if (refreshed?.url && refreshed.type === 'video') playback = refreshed;
      else if (!playback?.embedUrl && refreshed?.embedUrl) playback = refreshed;
    } catch (refreshErr) {
      console.warn('[dashboard] insight media refresh fallback', refreshErr.message);
    }
  }

  return applyPlaybackToMedia(playback, { isVideoAd, thumbnailUrl });
}

async function orgCanAccessMedia(organizationId, mediaId, mediaRow) {
  const claim = await db.OrganizationMediaClaim.findOne({
    where: { organizationId, mediaId },
    attributes: ['id'],
  });
  if (claim) return true;

  const analysis = await db.CreativeAnalysis.findOne({
    where: { organizationId, mediaId },
    attributes: ['id'],
  });
  if (analysis) return true;

  if (mediaRow?.metaVideoId) {
    const ad = await db.Ad.findOne({
      where: { organizationId, metaVideoId: mediaRow.metaVideoId },
      attributes: ['id'],
    });
    if (ad) return true;
  }

  return false;
}

/**
 * KPIs consolidados por organização na série diária de ads + contagem de análises criativas.
 */
async function getOverview(organizationId, { period = 'today', adIds = null } = {}) {
  const { since, until, period: resolvedPeriod } = metaMetrics.resolvePeriodDates(period);

  const normalizedAdIds =
    Array.isArray(adIds) && adIds.length
      ? [...new Set(adIds.map((id) => String(id).trim()).filter(Boolean))]
      : null;

  const adFilterSql = normalizedAdIds ? ' AND a.id IN (:adIds)' : '';
  const queryReplacements = normalizedAdIds
    ? { organizationId, since, until, adIds: normalizedAdIds }
    : { organizationId, since, until };

  const [spendAgg] = await db.sequelize.query(
    `SELECT COALESCE(SUM(apd.spend), 0)::decimal AS total_spend
     FROM ad_performance_daily apd
     INNER JOIN ads a ON a.id = apd.ad_id
     WHERE apd.organization_id = :organizationId
       AND apd.snapshot_date >= :since
       AND apd.snapshot_date <= :until${adFilterSql}`,
    {
      replacements: queryReplacements,
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
       AND apd.snapshot_date <= :until${adFilterSql}`,
    {
      replacements: queryReplacements,
      type: QueryTypes.SELECT,
    },
  );

  const analyzedWhere = { organizationId };
  if (normalizedAdIds) {
    analyzedWhere.adId = { [db.Sequelize.Op.in]: normalizedAdIds };
  }

  const analyzed = await db.CreativeAnalysis.count({
    where: analyzedWhere,
  });

  const perfWhere = {
    organizationId,
    snapshotDate: {
      [db.Sequelize.Op.gte]: since,
      [db.Sequelize.Op.lte]: until,
    },
  };
  if (normalizedAdIds) {
    perfWhere.adId = { [db.Sequelize.Op.in]: normalizedAdIds };
  }

  const perfRows = await db.AdPerformanceDaily.findAll({
    where: perfWhere,
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
        purchaseRevenue: 0,
        purchases: 0,
        roasWeighted: 0,
        roasSpend: 0,
      });
    }
    const daily = dailyMap.get(dateKey);
    daily.spend += spend;
    daily.impressions += impressions;
    daily.clicks += clicks;
    daily.reach += extracted.reach;
    daily.purchaseRevenue += extracted.purchaseRevenue;
    daily.purchases += extracted.purchases;
    daily.roasWeighted += roas * spend;
    daily.roasSpend += spend;

    if (!row.adId) continue;
    if (!adMap.has(row.adId)) {
      adMap.set(row.adId, {
        adId: row.adId,
        name: row.ad?.name || 'Anúncio ' + row.adId.slice(0, 4),
        spend: 0,
        impressions: 0,
        clicks: 0,
        pageViews: 0,
        initiateCheckouts: 0,
        addToCart: 0,
        purchases: 0,
        purchaseRevenue: 0,
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
    adData.purchaseRevenue += extracted.purchaseRevenue;
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

  function rankingEntry(best, formatScore) {
    if (!best) {
      return { adId: null, adName: null, score: null, display: 'Sem dados', hasData: false };
    }
    return {
      adId: best.item.adId,
      adName: best.item.name,
      score: best.score,
      display: formatScore(best.score),
      hasData: true,
    };
  }

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
  const bestRoi = getBest(adList, (ad) => {
    if (ad.spend <= 0) return null;
    if (ad.purchaseRevenue > 0) {
      return ((ad.purchaseRevenue - ad.spend) / ad.spend) * 100;
    }
    if (ad.roasSpend > 0) {
      const roasVal = ad.roasWeighted / ad.roasSpend;
      return (roasVal - 1) * 100;
    }
    return null;
  });
  const bestSalesVolume = getBest(adList, (ad) => ad.purchases);
  const bestConversionRate = getBest(adList, (ad) =>
    ad.pageViews > 0 ? (ad.purchases / ad.pageViews) * 100 : 0,
  );

  const rankingItems = [
    {
      id: 'bestHook',
      title: 'Melhores ganchos',
      subtitle: 'Views 3s ÷ impressões',
      metaFields: ['video_3_sec_watched_actions', 'impressions'],
      metaAvailable: true,
      accent: '#ffd700',
      ...rankingEntry(bestHook, (s) => `${s.toFixed(1)}%`),
    },
    {
      id: 'bestRetention',
      title: 'Melhor retenção no corpo',
      subtitle: '75% assistido ÷ plays iniciados',
      metaFields: ['video_p75_watched_actions', 'video_play_actions'],
      metaAvailable: true,
      accent: '#d4af37',
      ...rankingEntry(bestRetention, (s) => `${s.toFixed(1)}%`),
    },
    {
      id: 'bestCtr',
      title: 'Maior CTR',
      subtitle: 'Cliques ÷ impressões',
      metaFields: ['clicks', 'impressions'],
      metaAvailable: true,
      accent: '#eab308',
      ...rankingEntry(bestCtr, (s) => `${s.toFixed(2)}%`),
    },
    {
      id: 'bestCostIc',
      title: 'Menor custo de Initiate Checkout',
      subtitle: 'Gasto ÷ ICs',
      metaFields: ['spend', 'actions:initiate_checkout'],
      metaAvailable: true,
      accent: '#b8941f',
      ...rankingEntry(bestCostIc, (s) => `R$ ${s.toFixed(2)}`),
    },
    {
      id: 'bestRoi',
      title: 'Maior ROI',
      subtitle: '(Receita compra Meta − gasto) ÷ gasto',
      metaFields: ['action_values:purchase', 'spend', 'purchase_roas'],
      metaAvailable: true,
      accent: '#f5e6b8',
      ...rankingEntry(bestRoi, (s) => `${s.toFixed(1)}%`),
    },
    {
      id: 'bestSalesVolume',
      title: 'Maior volume de vendas',
      subtitle: 'Compras atribuídas (pixel Meta)',
      metaFields: ['actions:purchase'],
      metaAvailable: true,
      accent: '#c9a227',
      ...rankingEntry(bestSalesVolume, (s) => `${Math.round(s)} vendas`),
    },
    {
      id: 'bestConversionRate',
      title: 'Maior conversão',
      subtitle: 'Vendas ÷ page views',
      metaFields: ['actions:purchase', 'actions:landing_page_view'],
      metaAvailable: true,
      accent: '#a38b2a',
      ...rankingEntry(bestConversionRate, (s) => `${s.toFixed(2)}%`),
    },
  ];

  const dailyMeta = Array.from(dailyMap.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((d) => ({
      date: d.date,
      label: metaMetrics.formatDailyLabel(d.date),
      spend: Math.round(d.spend * 100) / 100,
      purchaseRevenue: Math.round(d.purchaseRevenue * 100) / 100,
      purchases: d.purchases,
      impressions: d.impressions,
      clicks: d.clicks,
      reach: d.reach,
      roas: d.roasSpend > 0 ? Math.round((d.roasWeighted / d.roasSpend) * 100) / 100 : 0,
      ctr: d.impressions > 0 ? Math.round((d.clicks / d.impressions) * 10000) / 100 : 0,
    }));

  const metaExtended = await metaMarketingFull
    .buildDashboardMetaExtended(organizationId, {
      since,
      until,
      period: resolvedPeriod,
    })
    .catch((err) => ({
      available: false,
      reason: 'meta_extended_fetch_failed',
      warning: err?.message || String(err),
      period: resolvedPeriod,
      dateRange: { since, until },
    }));

  const trafficSources =
    metaExtended?.metaTrafficSources?.length
      ? metaExtended.metaTrafficSources
      : [
          { label: 'Cliques (ads importados)', count: aggregated.delivery.clicks || 0 },
          { label: 'Compras atrib. Meta', count: aggregated.funnel.purchases || 0 },
          { label: 'Initiate Checkout', count: aggregated.funnel.initiateCheckouts || 0 },
        ].filter((row) => row.count > 0);

  return {
    period: resolvedPeriod,
    dateRange: { since, until },
    filteredAdIds: normalizedAdIds,
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
    /** Funil estilo UTMify — base 100% = cliques Meta */
    conversionFunnel: {
      clicks: aggregated.delivery.clicks || 0,
      pageViews: aggregated.funnel.pageViews || 0,
      initiateCheckouts: aggregated.funnel.initiateCheckouts || 0,
      addToCart: aggregated.funnel.addToCart || 0,
      purchasesMeta: aggregated.funnel.purchases || 0,
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
      bestRoi: bestRoi
        ? `${bestRoi.item.name} (${bestRoi.score.toFixed(1)}% ROI)`
        : 'Sem dados',
      bestSalesVolume: bestSalesVolume
        ? `${bestSalesVolume.item.name} (${bestSalesVolume.score} vendas)`
        : 'Sem dados',
      bestConversionRate: bestConversionRate
        ? `${bestConversionRate.item.name} (${bestConversionRate.score.toFixed(1)}%)`
        : 'Sem dados',
    },
    rankingItems,
    metaTrafficSources: trafficSources,
    metaExtended,
  };
}

const APPROVED_SALE_STATUSES = new Set([
  'paid',
  'approved',
  'succeeded',
  'pago',
  'completed',
]);
const PENDING_SALE_STATUSES = new Set(['pending', 'waiting', 'pendente', 'processing']);
const REFUND_SALE_STATUSES = new Set(['refunded', 'refund', 'reembolsado', 'chargeback']);

const DAY_LABELS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function localYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function formatDayChartLabel(ymd, { isLast, todayYmd, untilYmd }) {
  if (ymd === todayYmd && ymd === untilYmd) return 'Hoje';
  if (isLast && ymd === untilYmd) return 'Hoje';
  const parts = ymd.split('-');
  return `${parts[2]}/${parts[1]}`;
}

/** Série diária de receita aprovada PagTrust para gráfico de linha. */
function buildRevenueByDaySeries(sales, since, until) {
  const dailyMap = new Map();
  for (const sale of sales) {
    const statusClean = String(sale.status || '').toLowerCase();
    if (!APPROVED_SALE_STATUSES.has(statusClean)) continue;
    const ymd = localYmd(sale.saleDate);
    const amt = parseFloat(sale.amount || 0);
    dailyMap.set(ymd, (dailyMap.get(ymd) || 0) + amt);
  }

  const todayYmd = localYmd(new Date());
  const start = parseYmdLocal(since);
  const end = parseYmdLocal(until);
  const out = [];

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const ymd = localYmd(cur);
    out.push({
      date: ymd,
      label: '',
      valor: Math.round((dailyMap.get(ymd) || 0) * 100) / 100,
    });
  }

  for (let i = 0; i < out.length; i += 1) {
    out[i].label = formatDayChartLabel(out[i].date, {
      isLast: i === out.length - 1,
      todayYmd,
      untilYmd: until,
    });
  }

  return out;
}

function emptyRevenueByDaySeries(since, until) {
  if (!since || !until) return [];
  return buildRevenueByDaySeries([], since, until);
}

function emptyExternalSalesPayload(since, until) {
  return {
    totalRevenue: 0,
    totalSales: 0,
    approvedSales: 0,
    pendingSales: 0,
    refundedSales: 0,
    salesByPaymentMethod: [
      { name: 'Pix', value: 0, color: '#1d4ed8' },
      { name: 'Cartão', value: 0, color: '#60a5fa' },
      { name: 'Boleto', value: 0, color: '#fbbf24' },
      { name: 'Outros', value: 0, color: '#4b5563' },
    ],
    revenueByHour: Array.from({ length: 24 }, (_, i) => ({
      hora: `${String(i).padStart(2, '0')}:00`,
      valor: 0,
    })),
    profitByHour: Array.from({ length: 24 }, (_, i) => ({
      hora: `${String(i).padStart(2, '0')}:00`,
      receita: 0,
      lucro: 0,
    })),
    cumulativeHourly: Array.from({ length: 24 }, (_, i) => ({
      hora: `${String(i).padStart(2, '0')}:00`,
      receitaAcum: 0,
      investimentoAcum: 0,
      lucroAcum: 0,
    })),
    revenueByDay: emptyRevenueByDaySeries(since, until),
    salesByDayOfWeek: DAY_LABELS_PT.map((label) => ({ label, count: 0 })),
    salesByProduct: [],
    salesBySource: [],
    approvalRates: [
      { label: 'Pix', approved: 0, total: 0, pct: 0 },
      { label: 'Cartão', approved: 0, total: 0, pct: 0 },
      { label: 'Boleto', approved: 0, total: 0, pct: 0 },
    ],
    secondaryMetrics: {
      arpu: 0,
      marginPct: 0,
      refundRatePct: 0,
      cpa: 0,
      overallApprovalPct: 0,
    },
    isDemoData: false,
    dateRange: { since, until },
  };
}

/**
 * Agrega vendas externas (PagTrust/Utmify) para widgets do dashboard home.
 * @param {Array} sales — rows ExternalSale
 * @param {{ totalSpend?: number, metaPurchases?: number, creativeAnalyses?: number }} meta
 */
function aggregateExternalSalesStats(sales, meta = {}) {
  const totalSpend = Number(meta.totalSpend || 0);
  const metaPurchases = Number(meta.metaPurchases || 0);
  const creativeAnalyses = Number(meta.creativeAnalyses || 0);
  const since = meta.since || null;
  const until = meta.until || null;

  let totalRevenue = 0;
  let approvedSales = 0;
  let pendingSales = 0;
  let refundedSales = 0;

  let pixCount = 0;
  let cardCount = 0;
  let billetCount = 0;
  let otherCount = 0;

  const hourlyRevenue = Array.from({ length: 24 }, () => 0);
  const dayOfWeekCounts = Array.from({ length: 7 }, () => 0);
  const productMap = new Map();
  const sourceMap = new Map();
  const approvalMap = {
    pix: { approved: 0, total: 0 },
    credit_card: { approved: 0, total: 0 },
    billet: { approved: 0, total: 0 },
  };

  for (const sale of sales) {
    const amt = parseFloat(sale.amount || 0);
    const statusClean = String(sale.status || '').toLowerCase();
    const method = String(sale.paymentMethod || 'other').toLowerCase();
    const isApproved = APPROVED_SALE_STATUSES.has(statusClean);
    const isPending = PENDING_SALE_STATUSES.has(statusClean);
    const isRefund = REFUND_SALE_STATUSES.has(statusClean);

    if (isApproved) {
      totalRevenue += amt;
      approvedSales += 1;
    } else if (isPending) pendingSales += 1;
    else if (isRefund) refundedSales += 1;

    if (method === 'pix') pixCount += 1;
    else if (method === 'credit_card') cardCount += 1;
    else if (method === 'billet') billetCount += 1;
    else otherCount += 1;

    const approvalKey =
      method === 'pix' || method === 'credit_card' || method === 'billet' ? method : null;
    if (approvalKey && approvalMap[approvalKey]) {
      approvalMap[approvalKey].total += 1;
      if (isApproved) approvalMap[approvalKey].approved += 1;
    }

    const saleDt = new Date(sale.saleDate);
    const hour = saleDt.getHours();
    if (hour >= 0 && hour < 24 && isApproved) hourlyRevenue[hour] += amt;

    const dow = saleDt.getDay();
    if (dow >= 0 && dow < 7 && isApproved) dayOfWeekCounts[dow] += 1;

    const campaign = String(sale.utmCampaign || '').trim() || 'Sem campanha UTM';
    productMap.set(campaign, (productMap.get(campaign) || 0) + (isApproved ? 1 : 0));

    const src = String(sale.utmSource || '').trim() || 'Direto / sem UTM';
    sourceMap.set(src, (sourceMap.get(src) || 0) + (isApproved ? 1 : 0));
  }

  const revenueByHour = Array.from({ length: 24 }, (_, i) => ({
    hora: `${String(i).padStart(2, '0')}:00`,
    valor: Math.round(hourlyRevenue[i] * 100) / 100,
  }));

  const profitByHour = revenueByHour.map((row) => {
    const receita = row.valor;
    const spendShare =
      totalRevenue > 0 ? (totalSpend * receita) / totalRevenue : totalSpend / 24;
    const lucro = receita - spendShare;
    return {
      hora: row.hora,
      receita,
      lucro: Math.round(lucro * 100) / 100,
    };
  });

  let receitaAcum = 0;
  let investimentoAcum = 0;
  const cumulativeHourly = revenueByHour.map((row) => {
    receitaAcum += row.valor;
    const investHour =
      totalRevenue > 0 ? (totalSpend * row.valor) / totalRevenue : totalSpend / 24;
    investimentoAcum += investHour;
    return {
      hora: row.hora,
      receitaAcum: Math.round(receitaAcum * 100) / 100,
      investimentoAcum: Math.round(investimentoAcum * 100) / 100,
      lucroAcum: Math.round((receitaAcum - investimentoAcum) * 100) / 100,
    };
  });

  const salesByProduct = Array.from(productMap.entries())
    .map(([label, count]) => ({ label, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const salesBySource = Array.from(sourceMap.entries())
    .map(([label, count]) => ({ label, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const approvalRates = [
    {
      label: 'Pix',
      ...approvalMap.pix,
      pct: approvalMap.pix.total
        ? Math.round((approvalMap.pix.approved / approvalMap.pix.total) * 1000) / 10
        : 0,
    },
    {
      label: 'Cartão',
      ...approvalMap.credit_card,
      pct: approvalMap.credit_card.total
        ? Math.round((approvalMap.credit_card.approved / approvalMap.credit_card.total) * 1000) / 10
        : 0,
    },
    {
      label: 'Boleto',
      ...approvalMap.billet,
      pct: approvalMap.billet.total
        ? Math.round((approvalMap.billet.approved / approvalMap.billet.total) * 1000) / 10
        : 0,
    },
  ];

  const overallApprovalPct =
    sales.length > 0 ? Math.round((approvedSales / sales.length) * 1000) / 10 : 0;
  const arpu = approvedSales > 0 ? totalRevenue / approvedSales : 0;
  const profit = totalRevenue - totalSpend;
  const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
  const refundRatePct = sales.length > 0 ? (refundedSales / sales.length) * 100 : 0;
  const cpa = metaPurchases > 0 ? totalSpend / metaPurchases : 0;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalSales: sales.length,
    approvedSales,
    pendingSales,
    refundedSales,
    salesByPaymentMethod: [
      { name: 'Pix', value: pixCount, color: '#1d4ed8' },
      { name: 'Cartão', value: cardCount, color: '#60a5fa' },
      { name: 'Boleto', value: billetCount, color: '#fbbf24' },
      { name: 'Outros', value: otherCount, color: '#4b5563' },
    ],
    revenueByHour,
    profitByHour,
    cumulativeHourly,
    revenueByDay: since && until ? buildRevenueByDaySeries(sales, since, until) : [],
    salesByDayOfWeek: DAY_LABELS_PT.map((label, i) => ({ label, count: dayOfWeekCounts[i] })),
    salesByProduct,
    salesBySource,
    approvalRates,
    secondaryMetrics: {
      arpu: Math.round(arpu * 100) / 100,
      marginPct: Math.round(marginPct * 10) / 10,
      refundRatePct: Math.round(refundRatePct * 10) / 10,
      cpa: Math.round(cpa * 100) / 100,
      overallApprovalPct,
      pendingSales,
      refundedSales,
      totalSales: sales.length,
      creativeAnalyses,
    },
    isDemoData: false,
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
      ad.vturb_video_id,
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

    return {
      _row: r,
      gdf,
      ingestMeta,
      rawCreative,
    };
  });

  const thumbnailUrls = await enrichThumbnailUrlsForRows(
    organizationId,
    rows,
  );

  const mappedItems = items.map((entry, index) => {
    const r = entry._row;
    const gdf = entry.gdf;
    const thumbnailUrl = thumbnailUrls[index] || null;

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
      vturbVideoId: r.vturb_video_id || null,
      analyzedAt: r.analyzed_at,
      aiAnalysis: r.ai_analysis,
      aiUi: aiCreativeUi.buildAiCreativeUi(r.ai_analysis),
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
    items: mappedItems,
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

async function refreshMediaUrl(organizationId, mediaId, options = {}) {
  const media = await db.MediaAsset.findByPk(mediaId);

  if (!media || !(await orgCanAccessMedia(organizationId, mediaId, media))) {
    const err = new Error('media_not_found');
    err.statusCode = 404;
    throw err;
  }

  const adContext = await loadAdMediaContext(organizationId, {
    metaVideoId: media.metaVideoId,
    metaAdGraphId: options.metaAdGraphId || media.ingestMetadata?.metaAdGraphId || null,
    rawCreative: options.rawCreative || null,
  });

  const metaAdGraphId = adContext.metaAdGraphId;
  if (!media.metaVideoId && !metaAdGraphId) {
    const err = new Error('no_meta_reference_for_refresh');
    err.statusCode = 400;
    throw err;
  }

  const playback = await metaVideoPlayback.fetchMetaVideoPlayback(organizationId, {
    metaVideoId: media.metaVideoId,
    metaAdGraphId,
    rawCreative: adContext.rawCreative,
  });

  const resolvedThumb = metaThumbnail.pickBestUrlByResolution([
    playback.thumbnailUrl,
    media.ingestMetadata?.thumbnailUrl,
    metaThumbnail.pickThumbnailFromCreative(adContext.rawCreative),
  ].filter(Boolean));

  const shouldPersistThumb = metaThumbnail.shouldUpgradeStoredThumbnail(
    media.ingestMetadata?.thumbnailUrl,
    resolvedThumb,
  );

  if ((playback.url && playback.type === 'video') || shouldPersistThumb) {
    const nextMeta = {
      ...(media.ingestMetadata && typeof media.ingestMetadata === 'object'
        ? media.ingestMetadata
        : {}),
      thumbnailUrl: resolvedThumb || media.ingestMetadata?.thumbnailUrl || null,
      lastRefreshedAt: new Date().toISOString(),
      lastPlaybackStrategy: playback.strategy || null,
    };
    if (metaAdGraphId) nextMeta.metaAdGraphId = metaAdGraphId;
    await media.update({ ingestMetadata: nextMeta });

    if (playback.url && playback.type === 'video') {
      const resolvedVideoId = metaVideoPlayback.extractVideoIdFromRawCreative(adContext.rawCreative);
      if (resolvedVideoId && resolvedVideoId !== media.metaVideoId) {
        await media.update({ metaVideoId: resolvedVideoId }).catch(() => {});
      }
    }
  }

  if (resolvedThumb) {
    playback.thumbnailUrl = resolvedThumb;
  }

  return playback;
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
      ad.vturb_video_id,
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

  let perfRows = await db.AdPerformanceDaily.findAll({
    where: { organizationId, adId },
    order: [['snapshotDate', 'ASC']],
  });

  if (!perfRows.length && r.meta_ad_id) {
    try {
      const metasync = require('../MetaSync/metasync.service');
      const bounds = metaMetrics.resolvePeriodDates('month');
      await metasync.syncDailyPerformanceInternal(
        organizationId,
        adId,
        bounds.since,
        bounds.until,
      );
      perfRows = await db.AdPerformanceDaily.findAll({
        where: { organizationId, adId },
        order: [['snapshotDate', 'ASC']],
      });
    } catch (syncErr) {
      console.warn('[dashboard] lazy insights sync failed', syncErr.message);
    }
  }

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
  if (!metaVideoId) metaVideoId = metaVideoPlayback.extractVideoIdFromRawCreative(rawCreative);

  const isVideoAd =
    Boolean(metaVideoId) || String(rawCreative.object_type || '').toUpperCase() === 'VIDEO';

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
    thumbnailUrl = metaThumbnail.pickThumbnailFromCreative(rawCreative);
  }

  let mediaUrl = null;
  let mediaType = 'unknown';
  let embedUrl = null;

  if (googleDriveFileId) {
    mediaUrl = buildDriveViewUrl(googleDriveFileId);
    mediaType = 'drive';
  } else {
    try {
      const applied = await resolveInsightMediaPlayback(organizationId, {
        mediaId,
        metaVideoId,
        metaAdGraphId: r.meta_ad_id,
        rawCreative,
        isVideoAd,
        thumbnailUrl,
      });
      mediaUrl = applied.mediaUrl;
      mediaType = applied.mediaType;
      embedUrl = applied.embedUrl || null;
      if (applied.thumbnailUrl) thumbnailUrl = applied.thumbnailUrl;
    } catch (mediaErr) {
      console.warn('[dashboard] insight media resolve failed', mediaErr.message);
      mediaUrl = null;
      mediaType = isVideoAd ? 'video' : 'image';
      embedUrl = rawCreative.instagram_permalink_url || null;
    }

    if (metaVideoId && metaThumbnail.looksLikeLowResMetaThumb(thumbnailUrl)) {
      try {
        const { accessToken } = await metaService.getValidToken(organizationId);
        const hdThumb = await metaThumbnail.resolveMetaThumbnailUrl(accessToken, {
          creative: rawCreative,
          videoId: metaVideoId,
          graphClient: graph,
        });
        if (hdThumb) thumbnailUrl = hdThumb;
      } catch (_) {
        /** best-effort */
      }
    }
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
    vturb_video_id: r.vturb_video_id || null,
    vturbVideoId: r.vturb_video_id || null,
    thumbnail_url: thumbnailUrl,
    media_type: mediaType,
    media_url: mediaUrl,
    embed_url: embedUrl,
    performance_snapshot: r.performance_snapshot || { roas: 0, ctr: 0, spend: 0 },
    performance_daily,
    delivery: metaAggregated.delivery,
    funnel: metaAggregated.funnel,
    video_retention: metaAggregated.videoRetention,
    video_metrics: metaAggregated.video,
    video_play_curve: metaAggregated.videoPlayCurve,
    creative_health: metaAggregated.creativeHealth,
    ai_analysis: r.ai_analysis || null,
    ai_ui: aiCreativeUi.buildAiCreativeUi(r.ai_analysis || null, {
      videoMetrics: metaAggregated.video,
    }),
    delivery_note:
      performance_daily.length > 0
        ? null
        : 'Este anúncio não teve entrega (impressões/gasto) no período sincronizado na Meta.',
  };
}

async function getAdMediaPlayback(organizationId, adId) {
  const adRow = await db.Ad.findOne({ where: { id: adId, organizationId } });
  if (!adRow) {
    const err = new Error('Ad not found');
    err.statusCode = 404;
    throw err;
  }

  const rawCreative =
    adRow.rawCreativeData && typeof adRow.rawCreativeData === 'object'
      ? adRow.rawCreativeData
      : {};

  return metaVideoPlayback.fetchMetaVideoPlayback(organizationId, {
    metaVideoId: adRow.metaVideoId || metaVideoPlayback.extractVideoIdFromRawCreative(rawCreative),
    metaAdGraphId: adRow.metaAdId,
    rawCreative,
  });
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

async function linkVturbVideo(organizationId, adId, vturbVideoId) {
  const adRow = await db.Ad.findOne({ where: { id: adId, organizationId } });
  if (!adRow) {
    const err = new Error('Ad not found');
    err.statusCode = 404;
    throw err;
  }

  const cleanId = vturbVideoId != null ? String(vturbVideoId).trim() : '';
  await adRow.update({ vturbVideoId: cleanId.length ? cleanId : null });

  await db.CreativeAnalysis.update(
    { vturbVideoId: cleanId.length ? cleanId : null },
    { where: { organizationId, adId } },
  ).catch(() => {});

  return {
    adId,
    vturbVideoId: cleanId.length ? cleanId : null,
    vturb_video_id: cleanId.length ? cleanId : null,
  };
}

/**
 * Distribuição de formatos (9:16, 1:1, etc.) dos criativos importados da org.
 */
function resolveFormatRowThumbnail(row) {
  const rawCreative =
    row.raw_creative_data && typeof row.raw_creative_data === 'object'
      ? row.raw_creative_data
      : {};
  const ingestMeta =
    row.ingest_metadata && typeof row.ingest_metadata === 'object'
      ? row.ingest_metadata
      : {};
  const gdf = row.google_drive_file_id ? String(row.google_drive_file_id).trim() : '';
  if (gdf) return buildDriveThumbnailUrl(gdf);
  if (ingestMeta.thumbnailUrl) return String(ingestMeta.thumbnailUrl);
  return pickThumbnailFromRawCreative(rawCreative);
}

async function getCreativeFormats(organizationId) {
  const rows = await db.sequelize.query(
    `WITH latest_ca AS (
      SELECT DISTINCT ON (ad_id)
        ad_id, media_id
      FROM creative_analyses
      WHERE organization_id = :organizationId
      ORDER BY ad_id, analyzed_at DESC
    )
    SELECT
      ad.id AS ad_id,
      ad.name AS ad_name,
      ad.raw_creative_data,
      ad.is_dynamic_creative,
      ad.meta_video_id,
      camp.name AS campaign_name,
      ca.media_id,
      ma.google_drive_file_id,
      ma.ingest_metadata
    FROM ads ad
    LEFT JOIN ad_sets asn ON asn.id = ad.ad_set_id
    LEFT JOIN campaigns camp ON camp.id = asn.campaign_id AND camp.organization_id = :organizationId
    LEFT JOIN latest_ca ca ON ca.ad_id = ad.id
    LEFT JOIN media_assets ma ON ma.id = ca.media_id
    WHERE ad.organization_id = :organizationId
    ORDER BY ad.name ASC`,
    {
      replacements: { organizationId },
      type: QueryTypes.SELECT,
    },
  );

  const enrichedRows = rows.map((row) => ({
    ...row,
    format_thumbnail_url: resolveFormatRowThumbnail(row),
  }));

  return {
    ...creativeFormat.buildFormatsDistribution(enrichedRows),
    templateLibrary: require('../../Data/creative_format_templates').listCreativeFormatTemplates(),
    driveFolderUrl: require('../../Data/creative_format_templates').DRIVE_FOLDER_URL,
  };
}

module.exports = {
  getOverview,
  getInsights,
  getInsightDetails,
  getAdMediaPlayback,
  getAdMetaBreakdowns,
  listImportedCampaigns,
  refreshMediaUrl,
  getCreativeFormats,
  linkVturbVideo,
  aggregateExternalSalesStats,
  emptyExternalSalesPayload,
};
