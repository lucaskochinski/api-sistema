'use strict';

const metaService = require('../Features/Meta/meta.service');
const graph = require('./meta_graph.client');
const metaMetrics = require('./meta_insights_metrics.service');

const BREAKDOWN_FIELDS = 'impressions,reach,clicks,spend,ctr';

/** platform_position sozinho força action_type implícito — Meta exige par com publisher_platform. */
function buildBreakdownAttempts(requestedKey) {
  const key = String(requestedKey || '').trim();
  if (key === 'platform_position') {
    return [
      { apiBreakdown: 'publisher_platform,platform_position', responseKey: key },
      { apiBreakdown: 'publisher_platform', responseKey: 'publisher_platform' },
    ];
  }
  return [{ apiBreakdown: key, responseKey: key }];
}

function isInvalidBreakdownComboError(err) {
  const msg = String(
    err?.message || err?.metaFb?.message || err?.response?.data?.error?.message || '',
  ).toLowerCase();
  return (
    msg.includes('(#100)') ||
    (msg.includes('breakdown') && msg.includes('invalid')) ||
    (msg.includes('action_type') && msg.includes('platform_position'))
  );
}

function extractDimension(row, responseKey, apiBreakdown) {
  if (responseKey === 'platform_position' || apiBreakdown.includes('platform_position')) {
    const pub = row.publisher_platform ?? row.breakdowns?.publisher_platform;
    const pos = row.platform_position ?? row.breakdowns?.platform_position;
    if (pub && pos) return `${pub} · ${pos}`;
    if (pos) return String(pos);
    if (pub) return String(pub);
  }

  const dim =
    row[responseKey] != null
      ? String(row[responseKey])
      : row.breakdowns?.[responseKey] != null
        ? String(row.breakdowns[responseKey])
        : null;

  if (dim) return dim;

  const parts = String(apiBreakdown || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => row[part] ?? row.breakdowns?.[part])
    .filter((v) => v != null && String(v).trim());

  if (parts.length) return parts.map(String).join(' · ');
  return 'unknown';
}

function parseBreakdownRow(row, responseKey, apiBreakdown) {
  const dim = extractDimension(row, responseKey, apiBreakdown);
  const extracted = metaMetrics.extractDailyMetrics({ raw: row });

  return {
    dimension: dim,
    impressions: extracted.impressions,
    reach: extracted.reach,
    clicks: extracted.clicks,
    spend: Math.round(extracted.spend * 100) / 100,
    ctr: extracted.ctr,
    purchases: extracted.purchases,
    videoPlays: extracted.videoPlays,
    video3s: extracted.video3s,
    video75: extracted.video75,
    roas: extracted.spend > 0 ? Math.round((extracted.purchaseRevenue / extracted.spend) * 100) / 100 : 0,
  };
}

async function fetchInsightsBreakdownRows(accessToken, metaAdId, { apiBreakdown, timeRange }) {
  return graph.iterateAllEdges(accessToken, `${metaAdId}/insights`, {
    fields: BREAKDOWN_FIELDS,
    breakdowns: apiBreakdown,
    time_range: timeRange,
    limit: 500,
  });
}

async function fetchAdBreakdowns(organizationId, metaAdId, { breakdown, period = '30d' } = {}) {
  const breakdownKey = String(breakdown || '').trim();
  if (!metaMetrics.ALLOWED_BREAKDOWNS.includes(breakdownKey)) {
    const err = new Error('invalid_breakdown');
    err.statusCode = 400;
    throw err;
  }

  const { since, until } = metaMetrics.resolvePeriodDates(period);
  const { accessToken } = await metaService.getValidToken(organizationId);
  const timeRange = JSON.stringify({ since, until });

  const attempts = buildBreakdownAttempts(breakdownKey);
  let rows = [];
  let warning = null;
  let resolvedBreakdown = breakdownKey;

  for (const attempt of attempts) {
    try {
      rows = await fetchInsightsBreakdownRows(accessToken, metaAdId, {
        apiBreakdown: attempt.apiBreakdown,
        timeRange,
      });
      resolvedBreakdown = attempt.responseKey;
      warning = null;
      break;
    } catch (err) {
      if (!isInvalidBreakdownComboError(err)) throw err;
      warning = err.message || 'meta_breakdown_unavailable';
      rows = [];
    }
  }

  const byDim = new Map();
  const lastAttempt = attempts[attempts.length - 1];
  const parseKey = resolvedBreakdown;
  const parseApi =
    attempts.find((a) => a.responseKey === resolvedBreakdown)?.apiBreakdown ||
    lastAttempt.apiBreakdown;

  for (const row of rows) {
    const parsed = parseBreakdownRow(row, parseKey, parseApi);
    if (!byDim.has(parsed.dimension)) {
      byDim.set(parsed.dimension, { ...parsed });
    } else {
      const cur = byDim.get(parsed.dimension);
      cur.impressions += parsed.impressions;
      cur.reach += parsed.reach;
      cur.clicks += parsed.clicks;
      cur.spend += parsed.spend;
      cur.purchases += parsed.purchases;
      cur.videoPlays += parsed.videoPlays;
      cur.video3s += parsed.video3s;
      cur.video75 += parsed.video75;
    }
  }

  const items = Array.from(byDim.values())
    .map((item) => ({
      ...item,
      ctr: item.impressions > 0 ? Math.round((item.clicks / item.impressions) * 10000) / 100 : 0,
      hookRatePct: item.impressions > 0 ? Math.round((item.video3s / item.impressions) * 10000) / 100 : 0,
      retention75Pct: item.videoPlays > 0 ? Math.round((item.video75 / item.videoPlays) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  if (!items.length && !warning) {
    warning = 'no_delivery_in_period';
  }

  return {
    breakdown: resolvedBreakdown,
    requestedBreakdown: breakdownKey,
    dateRange: { since, until },
    items,
    warning,
  };
}

module.exports = {
  fetchAdBreakdowns,
};
