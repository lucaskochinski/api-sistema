'use strict';

const graph = require('./meta_graph.client');
const db = require('../Models');
const { extractDailyMetrics, sumActionTypes } = require('./meta_insights_metrics.service');

const MESSAGING_ACTION_TYPES = [
  'messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started_7d',
  'messaging_first_reply',
  'messaging_welcome_message_view',
  'messaging_blocked',
  'messaging_connected',
];

const CATALOG_FIELDS = [
  'catalog_segment_actions',
  'catalog_segment_value',
  'converted_product_quantity',
  'converted_product_value',
  'converted_product_omni_purchase',
].join(',');

const AUCTION_FIELDS = [
  'auction_bid',
  'auction_competitiveness',
  'auction_max_competitor_bid',
].join(',');

const ACCOUNT_BILLING_FIELDS = [
  'id',
  'name',
  'account_id',
  'currency',
  'account_status',
  'amount_spent',
  'balance',
  'spend_cap',
  'min_daily_budget',
  'is_prepay_account',
  'funding_source_details',
  'timezone_name',
  'timezone_offset_hours_utc',
].join(',');

const CAMPAIGN_STRUCTURE_FIELDS = [
  'id',
  'name',
  'objective',
  'status',
  'effective_status',
  'daily_budget',
  'lifetime_budget',
  'spend_cap',
  'budget_remaining',
  'buying_type',
  'bid_strategy',
  'start_time',
  'stop_time',
].join(',');

const ADSET_STRUCTURE_FIELDS = [
  'id',
  'name',
  'campaign_id',
  'status',
  'effective_status',
  'daily_budget',
  'lifetime_budget',
  'bid_amount',
  'billing_event',
  'optimization_goal',
  'destination_type',
  'start_time',
  'end_time',
].join(',');

function actPath(metaActId) {
  const s = String(metaActId || '').trim();
  if (!s) return '';
  return s.startsWith('act_') ? s : `act_${s}`;
}

function centsToDecimal(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function insightSpend(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fundingTypeLabel(type) {
  const map = {
    1: 'Cartão de crédito',
    2: 'Meta Wallet',
    3: 'Crédito Meta (pago)',
    4: 'Crédito estendido',
    6: 'Fatura',
    12: 'PayPal',
    13: 'PayPal Billing',
    17: 'Débito directo',
    20: 'Saldo armazenado',
  };
  return map[Number(type)] || null;
}

async function resolveAccessToken(organizationId) {
  const metaService = require('../Features/Meta/meta.service');
  try {
    const orgTok = await metaService.getValidToken(organizationId, { forceOrgToken: true });
    if (orgTok?.accessToken) return orgTok.accessToken;
  } catch {
    /* fallback system token */
  }
  try {
    const tok = await metaService.getValidToken(organizationId);
    return tok?.accessToken || null;
  } catch {
    return null;
  }
}

async function resolvePrimaryAdAccount(organizationId) {
  const linked = await db.sequelize.query(
    `SELECT maa.id, maa.meta_act_id AS "metaActId", maa.name
     FROM meta_ad_accounts maa
     INNER JOIN campaigns c ON c.meta_ad_account_id = maa.id
     WHERE maa.organization_id = :organizationId
     LIMIT 1`,
    {
      replacements: { organizationId },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );
  if (linked[0]) return linked[0];

  return db.MetaAdAccount.findOne({
    where: { organizationId },
    order: [['updatedAt', 'DESC']],
    raw: true,
  });
}

async function safeGraph(fn, fallback = null) {
  try {
    return { ok: true, data: await fn(), warning: null };
  } catch (err) {
    return {
      ok: false,
      data: fallback,
      warning: err?.message || String(err),
    };
  }
}

async function fetchAccountBilling(token, metaActId) {
  const act = actPath(metaActId);
  const raw = await graph.fbGet(token, act, { fields: ACCOUNT_BILLING_FIELDS });
  const fsd = raw?.funding_source_details || {};
  const currency = raw?.currency || 'BRL';

  return {
    actId: raw?.id || act,
    name: raw?.name || null,
    currency,
    accountStatus: raw?.account_status ?? null,
    amountSpent: centsToDecimal(raw?.amount_spent),
    balance: centsToDecimal(raw?.balance),
    spendCap: raw?.spend_cap ? centsToDecimal(raw.spend_cap) : null,
    minDailyBudget: raw?.min_daily_budget ? centsToDecimal(raw.min_daily_budget) : null,
    isPrepayAccount: Boolean(raw?.is_prepay_account),
    timezoneName: raw?.timezone_name || null,
    timezoneOffsetUtc: raw?.timezone_offset_hours_utc ?? null,
    fundingSource: {
      type: fsd.TYPE ?? null,
      typeLabel: fundingTypeLabel(fsd.TYPE) || fsd.DISPLAY_STRING || null,
      displayString: fsd.DISPLAY_STRING || null,
      amount: fsd.AMOUNT != null ? centsToDecimal(fsd.AMOUNT) : null,
      currency: fsd.CURRENCY || currency,
      expiration: fsd.EXPIRATION || null,
    },
  };
}

async function fetchAccountTransactions(token, metaActId, limit = 20) {
  const act = actPath(metaActId);
  const rows = await graph.iterateAllEdges(token, `${act}/transactions`, { limit: Math.min(limit, 50) });
  return rows.map((row) => ({
    id: row.id,
    time: row.time || null,
    chargeType: row.charge_type || null,
    status: row.status || null,
    amount: row.amount != null ? centsToDecimal(row.amount) : null,
    currency: row.currency || null,
    taxAmount: row.tax_amount != null ? centsToDecimal(row.tax_amount) : null,
  }));
}

async function fetchExtendedCredit(token, metaActId) {
  const act = actPath(metaActId);
  const rows = await graph.iterateAllEdges(token, `${act}/extendedcreditinvoicegroups`, { limit: 10 });
  return rows.map((row) => ({
    id: row.id,
    email: row.email || null,
    customerPoNumber: row.customer_po_number || null,
  }));
}

function timeRangeParams(since, until) {
  return {
    time_range: JSON.stringify({ since, until }),
    limit: 100,
  };
}

async function fetchAccountInsightsRows(token, metaActId, since, until, fields, extra = {}) {
  const act = actPath(metaActId);
  return graph.iterateAllEdges(token, `${act}/insights`, {
    fields,
    level: 'account',
    ...timeRangeParams(since, until),
    ...extra,
  });
}

async function fetchHourlySpend(token, metaActId, since, until) {
  const rows = await fetchAccountInsightsRows(
    token,
    metaActId,
    since,
    until,
    'spend,impressions,clicks',
    { breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone' },
  );

  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hora: `${String(i).padStart(2, '0')}:00`,
    spend: 0,
    impressions: 0,
    clicks: 0,
  }));

  for (const row of rows) {
    const hourKey =
      row.hourly_stats_aggregated_by_advertiser_time_zone ||
      row.hourly_stats_aggregated_by_audience_time_zone ||
      null;
    if (hourKey == null) continue;
    const hourNum = parseInt(String(hourKey).split(':')[0], 10);
    if (!Number.isFinite(hourNum) || hourNum < 0 || hourNum > 23) continue;
    buckets[hourNum].spend += insightSpend(row.spend);
    buckets[hourNum].impressions += Number(row.impressions || 0);
    buckets[hourNum].clicks += Number(row.clicks || 0);
  }

  return buckets.map((b) => ({
    ...b,
    spend: Math.round(b.spend * 100) / 100,
  }));
}

function aggregateBreakdownRows(rows, dimensionKeys) {
  const map = new Map();

  for (const row of rows) {
    const parts = dimensionKeys.map((k) => row[k] || 'unknown');
    const label = parts.join(' · ');
    const cur = map.get(label) || {
      label,
      dimensions: Object.fromEntries(dimensionKeys.map((k, i) => [k, parts[i]])),
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      purchaseRevenue: 0,
    };
    cur.spend += insightSpend(row.spend);
    cur.impressions += Number(row.impressions || 0);
    cur.clicks += Number(row.clicks || 0);
    const extracted = extractDailyMetrics({ raw: row });
    cur.purchases += extracted.purchases;
    cur.purchaseRevenue += extracted.purchaseRevenue;
    map.set(label, cur);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      spend: Math.round(item.spend * 100) / 100,
      purchaseRevenue: Math.round(item.purchaseRevenue * 100) / 100,
      ctr: item.impressions > 0 ? Math.round((item.clicks / item.impressions) * 10000) / 100 : 0,
      roas: item.spend > 0 ? Math.round((item.purchaseRevenue / item.spend) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

async function fetchBreakdown(token, metaActId, since, until, breakdowns, fields) {
  const rows = await fetchAccountInsightsRows(token, metaActId, since, until, fields, { breakdowns });
  const keys = breakdowns.split(',').map((k) => k.trim());
  return aggregateBreakdownRows(rows, keys);
}

async function fetchMessagingMetrics(token, metaActId, since, until) {
  const rows = await fetchAccountInsightsRows(
    token,
    metaActId,
    since,
    until,
    'spend,impressions,actions,cost_per_action_type',
    { action_breakdowns: 'action_type' },
  );

  const totals = {};
  for (const type of MESSAGING_ACTION_TYPES) totals[type] = 0;

  let spend = 0;
  for (const row of rows) {
    spend += insightSpend(row.spend);
    for (const type of MESSAGING_ACTION_TYPES) {
      totals[type] += sumActionTypes({ raw: row }, [type]);
    }
  }

  const items = MESSAGING_ACTION_TYPES.map((type) => ({
    actionType: type,
    label: type.replace(/_/g, ' '),
    count: totals[type],
  })).filter((x) => x.count > 0);

  return { spend: Math.round(spend * 100) / 100, items };
}

async function fetchCatalogMetrics(token, metaActId, since, until) {
  const rows = await fetchAccountInsightsRows(
    token,
    metaActId,
    since,
    until,
    `${CATALOG_FIELDS},spend,impressions`,
  );
  if (!rows.length) return { items: [], totals: {} };

  const row = rows[0];
  return {
    spend: insightSpend(row.spend),
    impressions: Number(row.impressions || 0),
    convertedProductQuantity: Number(row.converted_product_quantity || 0),
    convertedProductValue: insightSpend(row.converted_product_value || 0),
    catalogSegmentValue: insightSpend(row.catalog_segment_value || 0),
    raw: {
      catalog_segment_actions: row.catalog_segment_actions || [],
    },
  };
}

async function fetchAuctionMetrics(token, metaActId, since, until) {
  const act = actPath(metaActId);
  const rows = await graph.iterateAllEdges(token, `${act}/insights`, {
    fields: `${AUCTION_FIELDS},spend,impressions,clicks,ad_id,ad_name`,
    level: 'ad',
    sort: 'spend_descending',
    ...timeRangeParams(since, until),
    limit: 25,
  });

  return rows.slice(0, 15).map((row) => ({
    adId: row.ad_id || null,
    adName: row.ad_name || null,
    spend: insightSpend(row.spend),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    auctionBid: row.auction_bid != null ? Number(row.auction_bid) : null,
    auctionCompetitiveness:
      row.auction_competitiveness != null ? Number(row.auction_competitiveness) : null,
    auctionMaxCompetitorBid:
      row.auction_max_competitor_bid != null ? Number(row.auction_max_competitor_bid) : null,
  }));
}

async function fetchCampaignStructure(token, metaActId) {
  const act = actPath(metaActId);
  const campaigns = await graph.iterateAllEdges(token, `${act}/campaigns`, {
    fields: CAMPAIGN_STRUCTURE_FIELDS,
    limit: 50,
  });

  const adsets = await graph.iterateAllEdges(token, `${act}/adsets`, {
    fields: ADSET_STRUCTURE_FIELDS,
    limit: 80,
  });

  const adsetByCampaign = new Map();
  for (const as of adsets) {
    const cid = as.campaign_id;
    if (!adsetByCampaign.has(cid)) adsetByCampaign.set(cid, []);
    adsetByCampaign.get(cid).push({
      id: as.id,
      name: as.name,
      status: as.effective_status || as.status,
      dailyBudget: as.daily_budget ? centsToDecimal(as.daily_budget) : null,
      optimizationGoal: as.optimization_goal || null,
      destinationType: as.destination_type || null,
      billingEvent: as.billing_event || null,
    });
  }

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective || null,
    status: c.effective_status || c.status,
    dailyBudget: c.daily_budget ? centsToDecimal(c.daily_budget) : null,
    lifetimeBudget: c.lifetime_budget ? centsToDecimal(c.lifetime_budget) : null,
    spendCap: c.spend_cap ? centsToDecimal(c.spend_cap) : null,
    budgetRemaining: c.budget_remaining ? centsToDecimal(c.budget_remaining) : null,
    bidStrategy: c.bid_strategy || null,
    buyingType: c.buying_type || null,
    adSets: (adsetByCampaign.get(c.id) || []).slice(0, 8),
  }));
}

async function buildDashboardMetaExtended(organizationId, { since, until, period = 'month' } = {}) {
  const account = await resolvePrimaryAdAccount(organizationId);
  if (!account) {
    return {
      available: false,
      reason: 'no_meta_ad_account',
      period,
      dateRange: { since, until },
    };
  }

  const token = await resolveAccessToken(organizationId);
  if (!token) {
    return {
      available: false,
      reason: 'meta_token_not_configured',
      account: { id: account.id, metaActId: account.metaActId, name: account.name },
      period,
      dateRange: { since, until },
    };
  }

  const metaActId = account.metaActId;
  const breakdownFields = 'impressions,clicks,spend,actions,action_values';

  const [
    billing,
    transactions,
    extendedCredit,
    hourlySpend,
    platformBreakdown,
    demographics,
    creativeAssets,
    messaging,
    catalog,
    auction,
    structure,
  ] = await Promise.all([
    safeGraph(() => fetchAccountBilling(token, metaActId)),
    safeGraph(() => fetchAccountTransactions(token, metaActId), []),
    safeGraph(() => fetchExtendedCredit(token, metaActId), []),
    safeGraph(() => fetchHourlySpend(token, metaActId, since, until), []),
    safeGraph(() =>
      fetchBreakdown(token, metaActId, since, until, 'publisher_platform,platform_position', breakdownFields),
    ),
    safeGraph(() => fetchBreakdown(token, metaActId, since, until, 'age,gender', breakdownFields)),
    safeGraph(() =>
      fetchBreakdown(token, metaActId, since, until, 'body_asset,title_asset,video_asset', breakdownFields),
    ),
    safeGraph(() => fetchMessagingMetrics(token, metaActId, since, until)),
    safeGraph(() => fetchCatalogMetrics(token, metaActId, since, until)),
    safeGraph(() => fetchAuctionMetrics(token, metaActId, since, until), []),
    safeGraph(() => fetchCampaignStructure(token, metaActId), []),
  ]);

  const platformItems = (platformBreakdown.data || []).map((row) => ({
    label: row.label,
    count: row.clicks,
    spend: row.spend,
    purchases: row.purchases,
    roas: row.roas,
  }));

  return {
    available: true,
    period,
    dateRange: { since, until },
    account: {
      id: account.id,
      metaActId,
      name: account.name,
    },
    billing: billing.data,
    billingWarning: billing.warning,
    transactions: transactions.data || [],
    transactionsWarning: transactions.warning,
    extendedCredit: extendedCredit.data || [],
    extendedCreditWarning: extendedCredit.warning,
    hourlySpend: hourlySpend.data || [],
    hourlySpendWarning: hourlySpend.warning,
    platformBreakdown: platformBreakdown.data || [],
    platformBreakdownWarning: platformBreakdown.warning,
    demographics: demographics.data || [],
    demographicsWarning: demographics.warning,
    creativeAssets: creativeAssets.data || [],
    creativeAssetsWarning: creativeAssets.warning,
    messaging: messaging.data || { items: [], spend: 0 },
    messagingWarning: messaging.warning,
    catalog: catalog.data || null,
    catalogWarning: catalog.warning,
    auction: auction.data || [],
    auctionWarning: auction.warning,
    campaignStructure: structure.data || [],
    structureWarning: structure.warning,
    metaTrafficSources: platformItems.length
      ? platformItems.map((p) => ({ label: p.label, count: p.count }))
      : null,
  };
}

module.exports = {
  actPath,
  buildDashboardMetaExtended,
  fetchAccountBilling,
  fetchHourlySpend,
  fetchBreakdown,
  MESSAGING_ACTION_TYPES,
};
