'use strict';

/** Campos pedidos ao Graph em cada sync/import de insights (nível ad, diário). */
const INSIGHT_FIELDS = [
  'date_start',
  'date_stop',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'spend',
  'ctr',
  'cpc',
  'cpm',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'cost_per_inline_link_click',
  'outbound_clicks',
  'unique_outbound_clicks',
  'inline_post_engagement',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
  'website_purchase_roas',
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',
  'video_play_actions',
  'video_continuous_2_sec_watched_actions',
  'video_15_sec_watched_actions',
  'video_30_sec_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_avg_time_watched_actions',
  'video_time_watched_actions',
  'video_thruplay_watched_actions',
  'video_view_per_impression',
  'video_play_curve_actions',
  'video_play_retention_0_to_15s_actions',
  'video_play_retention_20_to_60s_actions',
  'canvas_avg_view_percent',
  'canvas_avg_view_time',
].join(',');

const PURCHASE_ACTION_TYPES = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'web_in_store_purchase',
];

const CHECKOUT_ACTION_TYPES = [
  'initiate_checkout',
  'omni_initiated_checkout',
  'offsite_conversion.fb_pixel_initiate_checkout',
];

const PAGE_VIEW_ACTION_TYPES = [
  'landing_page_view',
  'omni_landing_page_view',
  'link_click',
];

const ADD_TO_CART_ACTION_TYPES = [
  'add_to_cart',
  'omni_add_to_cart',
  'offsite_conversion.fb_pixel_add_to_cart',
];

const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped'];

const VIDEO_CURVE_LABELS = [
  '0s', '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s',
  '15-20s', '20-25s', '25-30s', '30-40s', '40-50s', '50-60s', '60s+',
];

function rawRow(metricsJsonb) {
  return metricsJsonb?.raw && typeof metricsJsonb.raw === 'object' ? metricsJsonb.raw : {};
}

function numField(metricsJsonb, field) {
  const v = rawRow(metricsJsonb)[field];
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function strField(metricsJsonb, field) {
  const v = rawRow(metricsJsonb)[field];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

function isMeaningfulMetaRanking(value) {
  if (!value) return false;
  const normalized = String(value).trim().toUpperCase();
  return normalized !== 'UNKNOWN' && normalized !== 'N/A' && normalized !== 'NONE';
}

function assignMetaRanking(agg, field, value) {
  if (!value) return;
  if (isMeaningfulMetaRanking(value)) {
    agg[field] = value;
    return;
  }
  if (!agg[field]) agg[field] = value;
}

function sumAction(metricsJsonb, actionType) {
  const actions = rawRow(metricsJsonb).actions || [];
  const match = actions.find((a) => a.action_type === actionType);
  return match ? Number(match.value || 0) : 0;
}

function sumActionTypes(metricsJsonb, actionTypes) {
  let total = 0;
  for (const t of actionTypes) total += sumAction(metricsJsonb, t);
  return total;
}

function sumActionValue(metricsJsonb, actionType) {
  const actions = rawRow(metricsJsonb).action_values || [];
  const match = actions.find((a) => a.action_type === actionType);
  return match ? Number(match.value || 0) : 0;
}

function sumActionValueTypes(metricsJsonb, actionTypes) {
  let total = 0;
  for (const t of actionTypes) total += sumActionValue(metricsJsonb, t);
  return total;
}

function sumVideoAction(metricsJsonb, actionField) {
  const actions = rawRow(metricsJsonb)[actionField] || [];
  if (!Array.isArray(actions) || !actions.length) return 0;

  const videoView = actions.find((a) => a.action_type === 'video_view');
  if (videoView) return Number(videoView.value || 0);

  return actions.reduce((acc, a) => acc + Number(a.value || 0), 0);
}

function sumCallToActionClicks(metricsJsonb) {
  const fromActions =
    sumAction(metricsJsonb, 'call_to_action_click') +
    sumAction(metricsJsonb, 'call_to_action_clicks');
  if (fromActions > 0) return fromActions;
  return numField(metricsJsonb, 'call_to_action_clicks');
}

function sumVideo3SecHook(metricsJsonb) {
  const legacy = sumVideoAction(metricsJsonb, 'video_3_sec_watched_actions');
  if (legacy > 0) return legacy;
  return sumVideoAction(metricsJsonb, 'video_continuous_2_sec_watched_actions');
}

function sumVideo6Sec(metricsJsonb) {
  const legacy = sumVideoAction(metricsJsonb, 'video_6_sec_watched_actions');
  if (legacy > 0) return legacy;
  return sumVideoAction(metricsJsonb, 'video_15_sec_watched_actions');
}

function sumVideoAvgTime(metricsJsonb) {
  const actions = rawRow(metricsJsonb).video_avg_time_watched_actions || [];
  if (!Array.isArray(actions) || !actions.length) return 0;

  const videoView = actions.find((a) => a.action_type === 'video_view');
  if (videoView) return Number(videoView.value || 0);

  return actions.reduce((acc, a) => acc + Number(a.value || 0), 0);
}

function parseVideoPlayCurve(metricsJsonb) {
  const actions = rawRow(metricsJsonb).video_play_curve_actions || [];
  const videoView = actions.find((a) => a.action_type === 'video_view');
  if (!videoView || !Array.isArray(videoView.value)) return null;

  return videoView.value.map((pct, i) => ({
    index: i,
    label: VIDEO_CURVE_LABELS[i] || `${i}`,
    pct: Number(pct) || 0,
  }));
}

function extractDailyMetrics(metricsJsonb) {
  return {
    impressions: numField(metricsJsonb, 'impressions'),
    reach: numField(metricsJsonb, 'reach'),
    frequency: numField(metricsJsonb, 'frequency'),
    clicks: numField(metricsJsonb, 'clicks'),
    spend: numField(metricsJsonb, 'spend'),
    ctr: numField(metricsJsonb, 'ctr'),
    cpc: numField(metricsJsonb, 'cpc'),
    cpm: numField(metricsJsonb, 'cpm'),
    inlineLinkClicks: numField(metricsJsonb, 'inline_link_clicks'),
    inlineLinkClickCtr: numField(metricsJsonb, 'inline_link_click_ctr'),
    costPerInlineLinkClick: numField(metricsJsonb, 'cost_per_inline_link_click'),
    outboundClicks: numField(metricsJsonb, 'outbound_clicks'),
    callToActionClicks: sumCallToActionClicks(metricsJsonb),
    inlinePostEngagement: numField(metricsJsonb, 'inline_post_engagement'),
    canvasAvgViewPercent: numField(metricsJsonb, 'canvas_avg_view_percent'),
    canvasAvgViewTime: numField(metricsJsonb, 'canvas_avg_view_time'),
    videoViewPerImpression: numField(metricsJsonb, 'video_view_per_impression'),
    qualityRanking: strField(metricsJsonb, 'quality_ranking'),
    engagementRateRanking: strField(metricsJsonb, 'engagement_rate_ranking'),
    conversionRateRanking: strField(metricsJsonb, 'conversion_rate_ranking'),
    creativeDiversityScore: strField(metricsJsonb, 'creative_diversity_score'),
    creativeDiversityLabel: strField(metricsJsonb, 'creative_diversity_label'),
    creativeFatigueSummary: rawRow(metricsJsonb).creative_fatigue_summary || null,
    isVideo: strField(metricsJsonb, 'is_video'),
    pageViews: sumActionTypes(metricsJsonb, PAGE_VIEW_ACTION_TYPES),
    initiateCheckouts: sumActionTypes(metricsJsonb, CHECKOUT_ACTION_TYPES),
    addToCart: sumActionTypes(metricsJsonb, ADD_TO_CART_ACTION_TYPES),
    purchases: sumActionTypes(metricsJsonb, PURCHASE_ACTION_TYPES),
    leads: sumActionTypes(metricsJsonb, LEAD_ACTION_TYPES),
    purchaseRevenue: sumActionValueTypes(metricsJsonb, PURCHASE_ACTION_TYPES),
    videoPlays: sumVideoAction(metricsJsonb, 'video_play_actions'),
    video2s: sumVideoAction(metricsJsonb, 'video_continuous_2_sec_watched_actions'),
    video3s: sumVideo3SecHook(metricsJsonb),
    video6s: sumVideo6Sec(metricsJsonb),
    video15s: sumVideoAction(metricsJsonb, 'video_15_sec_watched_actions'),
    video25: sumVideoAction(metricsJsonb, 'video_p25_watched_actions'),
    video50: sumVideoAction(metricsJsonb, 'video_p50_watched_actions'),
    video75: sumVideoAction(metricsJsonb, 'video_p75_watched_actions'),
    video95: sumVideoAction(metricsJsonb, 'video_p95_watched_actions'),
    video100: sumVideoAction(metricsJsonb, 'video_p100_watched_actions'),
    video30s: sumVideoAction(metricsJsonb, 'video_30_sec_watched_actions'),
    videoThruplay: sumVideoAction(metricsJsonb, 'video_thruplay_watched_actions'),
    videoAvgTime: sumVideoAvgTime(metricsJsonb),
    videoTimeWatched: sumVideoAction(metricsJsonb, 'video_time_watched_actions'),
    videoPlayCurve: parseVideoPlayCurve(metricsJsonb),
  };
}

function emptyAggregate() {
  return {
    impressions: 0,
    reach: 0,
    frequencyWeighted: 0,
    frequencyWeight: 0,
    clicks: 0,
    spend: 0,
    inlineLinkClicks: 0,
    outboundClicks: 0,
    callToActionClicks: 0,
    inlinePostEngagement: 0,
    pageViews: 0,
    initiateCheckouts: 0,
    addToCart: 0,
    purchases: 0,
    leads: 0,
    purchaseRevenue: 0,
    videoPlays: 0,
    video2s: 0,
    video3s: 0,
    video6s: 0,
    video15s: 0,
    video25: 0,
    video50: 0,
    video75: 0,
    video95: 0,
    video100: 0,
    video30s: 0,
    videoThruplay: 0,
    videoAvgTimeWeighted: 0,
    videoAvgTimeWeight: 0,
    videoTimeWatched: 0,
    canvasAvgViewPercentWeighted: 0,
    canvasAvgViewWeight: 0,
    curveWeighted: null,
    curveWeight: 0,
    qualityRanking: null,
    engagementRateRanking: null,
    conversionRateRanking: null,
    creativeDiversityScore: null,
    creativeDiversityLabel: null,
    creativeFatigueSummary: null,
  };
}

function aggregateDailyMetrics(rows) {
  const agg = emptyAggregate();

  for (const row of rows) {
    const m = extractDailyMetrics(row.metricsJsonb || row);

    agg.impressions += m.impressions;
    agg.reach += m.reach;
    if (m.frequency > 0 && m.impressions > 0) {
      agg.frequencyWeighted += m.frequency * m.impressions;
      agg.frequencyWeight += m.impressions;
    }
    agg.clicks += m.clicks;
    agg.spend += m.spend;
    agg.inlineLinkClicks += m.inlineLinkClicks;
    agg.outboundClicks += m.outboundClicks;
    agg.callToActionClicks += m.callToActionClicks;
    agg.inlinePostEngagement += m.inlinePostEngagement;
    agg.pageViews += m.pageViews;
    agg.initiateCheckouts += m.initiateCheckouts;
    agg.addToCart += m.addToCart;
    agg.purchases += m.purchases;
    agg.leads += m.leads;
    agg.purchaseRevenue += m.purchaseRevenue;
    agg.videoPlays += m.videoPlays;
    agg.video2s += m.video2s;
    agg.video3s += m.video3s;
    agg.video6s += m.video6s;
    agg.video15s += m.video15s;
    agg.video25 += m.video25;
    agg.video50 += m.video50;
    agg.video75 += m.video75;
    agg.video95 += m.video95;
    agg.video100 += m.video100;
    agg.video30s += m.video30s;
    agg.videoThruplay += m.videoThruplay;
    agg.videoTimeWatched += m.videoTimeWatched;
    if (m.videoPlays > 0 && m.videoAvgTime > 0) {
      agg.videoAvgTimeWeighted += m.videoAvgTime * m.videoPlays;
      agg.videoAvgTimeWeight += m.videoPlays;
    }
    if (m.canvasAvgViewPercent > 0 && m.impressions > 0) {
      agg.canvasAvgViewPercentWeighted += m.canvasAvgViewPercent * m.impressions;
      agg.canvasAvgViewWeight += m.impressions;
    }
    if (m.videoPlayCurve && m.videoPlays > 0) {
      if (!agg.curveWeighted) {
        agg.curveWeighted = m.videoPlayCurve.map((p) => ({ ...p, weighted: 0 }));
      }
      for (let i = 0; i < m.videoPlayCurve.length; i++) {
        if (agg.curveWeighted[i]) {
          agg.curveWeighted[i].weighted += m.videoPlayCurve[i].pct * m.videoPlays;
        }
      }
      agg.curveWeight += m.videoPlays;
    }
    if (m.qualityRanking) assignMetaRanking(agg, 'qualityRanking', m.qualityRanking);
    if (m.engagementRateRanking) assignMetaRanking(agg, 'engagementRateRanking', m.engagementRateRanking);
    if (m.conversionRateRanking) assignMetaRanking(agg, 'conversionRateRanking', m.conversionRateRanking);
    if (m.creativeDiversityScore) agg.creativeDiversityScore = m.creativeDiversityScore;
    if (m.creativeDiversityLabel) agg.creativeDiversityLabel = m.creativeDiversityLabel;
    if (m.creativeFatigueSummary) agg.creativeFatigueSummary = m.creativeFatigueSummary;
  }

  return formatAggregate(agg);
}

function formatAggregate(agg) {
  const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
  const cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
  const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
  const roas = agg.spend > 0 ? agg.purchaseRevenue / agg.spend : 0;
  const frequency =
    agg.frequencyWeight > 0 ? agg.frequencyWeighted / agg.frequencyWeight : 0;
  const avgWatchTimeSec =
    agg.videoAvgTimeWeight > 0 ? agg.videoAvgTimeWeighted / agg.videoAvgTimeWeight : 0;

  let videoPlayCurve = null;
  if (agg.curveWeighted && agg.curveWeight > 0) {
    videoPlayCurve = agg.curveWeighted.map((p) => ({
      index: p.index,
      label: p.label,
      pct: Math.round((p.weighted / agg.curveWeight) * 10) / 10,
    }));
  }

  return {
    delivery: {
      impressions: agg.impressions,
      reach: agg.reach,
      frequency: Math.round(frequency * 100) / 100,
      clicks: agg.clicks,
      spend: Math.round(agg.spend * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
      cpm: Math.round(cpm * 100) / 100,
      inlineLinkClicks: agg.inlineLinkClicks,
      outboundClicks: agg.outboundClicks,
      callToActionClicks: agg.callToActionClicks,
      inlinePostEngagement: agg.inlinePostEngagement,
      roas: Math.round(roas * 100) / 100,
      purchaseRevenue: Math.round(agg.purchaseRevenue * 100) / 100,
    },
    funnel: {
      pageViews: agg.pageViews,
      initiateCheckouts: agg.initiateCheckouts,
      addToCart: agg.addToCart,
      purchases: agg.purchases,
      leads: agg.leads,
    },
    video: {
      plays: agg.videoPlays,
      watched2s: agg.video2s,
      watched3s: agg.video3s,
      watched6s: agg.video6s,
      watched15s: agg.video15s,
      watched30s: agg.video30s,
      watched25pct: agg.video25,
      watched50pct: agg.video50,
      watched75pct: agg.video75,
      watched95pct: agg.video95,
      watched100pct: agg.video100,
      thruplay: agg.videoThruplay,
      avgWatchTimeSec: Math.round(avgWatchTimeSec * 10) / 10,
      totalTimeWatchedSec: agg.videoTimeWatched,
      hookRatePct: agg.impressions > 0 ? Math.round((agg.video3s / agg.impressions) * 10000) / 100 : 0,
      retention75Pct: agg.videoPlays > 0 ? Math.round((agg.video75 / agg.videoPlays) * 10000) / 100 : 0,
    },
    creativeHealth: {
      qualityRanking: isMeaningfulMetaRanking(agg.qualityRanking) ? agg.qualityRanking : null,
      engagementRateRanking: isMeaningfulMetaRanking(agg.engagementRateRanking)
        ? agg.engagementRateRanking
        : null,
      conversionRateRanking: isMeaningfulMetaRanking(agg.conversionRateRanking)
        ? agg.conversionRateRanking
        : null,
      creativeDiversityScore: agg.creativeDiversityScore,
      creativeDiversityLabel: agg.creativeDiversityLabel,
      creativeFatigueSummary: agg.creativeFatigueSummary,
      canvasAvgViewPercent:
        agg.canvasAvgViewWeight > 0
          ? Math.round((agg.canvasAvgViewPercentWeighted / agg.canvasAvgViewWeight) * 10) / 10
          : null,
    },
    videoRetention: buildVideoRetention(agg),
    videoPlayCurve,
  };
}

function buildVideoRetention(totals) {
  const plays = Number(totals.videoPlays || totals.plays || 0);

  const steps = [
    { label: 'Plays', value: plays },
    { label: '2 seg', value: Number(totals.video2s || totals.watched2s || 0) },
    { label: '3 seg', value: Number(totals.video3s || totals.watched3s || 0) },
    { label: '6 seg', value: Number(totals.video6s || totals.watched6s || 0) },
    { label: '15 seg', value: Number(totals.video15s || totals.watched15s || 0) },
    { label: '25%', value: Number(totals.video25 || totals.watched25pct || 0) },
    { label: '50%', value: Number(totals.video50 || totals.watched50pct || 0) },
    { label: '75%', value: Number(totals.video75 || totals.watched75pct || 0) },
    { label: '95%', value: Number(totals.video95 || totals.watched95pct || 0) },
    { label: '100%', value: Number(totals.video100 || totals.watched100pct || 0) },
    { label: 'ThruPlay', value: Number(totals.videoThruplay || totals.thruplay || 0) },
  ];

  return steps.map((step) => ({
    label: step.label,
    value: step.value,
    pct: plays > 0 ? Math.round((step.value / plays) * 1000) / 10 : 0,
  }));
}

function resolvePeriodDates(period) {
  const until = new Date();
  until.setUTCHours(0, 0, 0, 0);

  const since = new Date(until);
  const key = String(period || 'today').toLowerCase().trim();

  if (key === 'week' || key === '7d') {
    since.setUTCDate(since.getUTCDate() - 6);
  } else if (key === 'month' || key === '30d') {
    since.setUTCDate(since.getUTCDate() - 29);
  }

  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    period: key,
  };
}

function formatDailyLabel(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

const ALLOWED_BREAKDOWNS = [
  'publisher_platform',
  'platform_position',
  'device_platform',
  'age',
  'gender',
  'body_asset',
  'title_asset',
  'video_asset',
  'image_asset',
  'call_to_action_asset',
  'link_url_asset',
];

module.exports = {
  INSIGHT_FIELDS,
  ALLOWED_BREAKDOWNS,
  PURCHASE_ACTION_TYPES,
  sumAction,
  sumActionTypes,
  sumVideoAction,
  sumVideoAvgTime,
  extractDailyMetrics,
  aggregateDailyMetrics,
  buildVideoRetention,
  parseVideoPlayCurve,
  resolvePeriodDates,
  formatDailyLabel,
};
