'use strict';

const metaService = require('../Features/Meta/meta.service');
const graph = require('./meta_graph.client');
const metaMetrics = require('./meta_insights_metrics.service');

/** Campos compatíveis com breakdowns de placement (sem video_* — exigem action_type). */
const BREAKDOWN_FIELDS = [
  'impressions',
  'reach',
  'clicks',
  'spend',
  'ctr',
  'cpc',
  'cpm',
  'inline_link_clicks',
  'actions',
  'action_values',
  'purchase_roas',
].join(',');

const BREAKDOWN_FIELDS_MINIMAL = [
  'impressions',
  'reach',
  'clicks',
  'spend',
  'ctr',
].join(',');

function isInvalidBreakdownComboError(err) {
  const msg = String(err?.message || err?.metaFb?.message || '').toLowerCase();
  return msg.includes('breakdown') && (msg.includes('invalid') || msg.includes('(#100)'));
}

function parseBreakdownRow(row, breakdownKey) {
  const dim =
    row[breakdownKey] != null
      ? String(row[breakdownKey])
      : row.breakdowns?.[breakdownKey] != null
        ? String(row.breakdowns[breakdownKey])
        : 'unknown';

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

async function fetchInsightsBreakdownRows(accessToken, metaAdId, { breakdownKey, timeRange, fields }) {
  return graph.iterateAllEdges(accessToken, `${metaAdId}/insights`, {
    fields,
    breakdowns: breakdownKey,
    time_range: timeRange,
    limit: 100,
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
  let rows;
  let warning = null;

  try {
    rows = await fetchInsightsBreakdownRows(accessToken, metaAdId, {
      breakdownKey,
      timeRange,
      fields: BREAKDOWN_FIELDS,
    });
  } catch (err) {
    if (!isInvalidBreakdownComboError(err)) throw err;
    warning = err.message || 'meta_breakdown_fields_fallback';
    rows = await fetchInsightsBreakdownRows(accessToken, metaAdId, {
      breakdownKey,
      timeRange,
      fields: BREAKDOWN_FIELDS_MINIMAL,
    });
  }

  const byDim = new Map();
  for (const row of rows) {
    const parsed = parseBreakdownRow(row, breakdownKey);
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

  return {
    breakdown: breakdownKey,
    dateRange: { since, until },
    items,
    warning,
  };
}

module.exports = {
  fetchAdBreakdowns,
};
