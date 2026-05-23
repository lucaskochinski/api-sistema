'use strict';

const { Op } = require('sequelize');
const metaService = require('../Meta/meta.service');
const db = require('../../Models');
const graph = require('../../Services/meta_graph.client');
const { enqueueVideoAnalyzeJob } = require('../../Workers/queues/videoTranscription.queue');
const planLimits = require('../../Services/plan_limits.service');
const transcriptionUsage = require('../../Services/transcription_usage.service');
const metaCreativeParser = require('./meta_ad_creative_parser');
const creativeFormat = require('../../Services/creative_format.service');
const { INSIGHT_FIELDS } = require('../../Services/meta_insights_metrics.service');

const GRAPH_PAGE_LIMIT = Math.min(
  200,
  Math.max(25, Number(process.env.META_SYNC_PAGE_LIMIT || 100)),
);

const LIVE_CAM_FIELDS = ['id', 'name', 'status'].join(',');

const ADSET_FIELDS = ['id', 'name', 'status', 'campaign_id', 'updated_time'].join(',');

const CREATIVE_GRAPH_FIELDS = [
  'id',
  'name',
  'object_type',
  'body',
  'title',
  'call_to_action_type',
  'thumbnail_url',
  'image_url',
  'video_id',
  'link_url',
  'status',
  'effective_object_story_id',
  'effective_instagram_media_id',
  'instagram_permalink_url',
  'object_story_spec',
  'asset_feed_spec',
].join(',');

const AD_FIELDS = [
  'id',
  'name',
  'status',
  'adset_id',
  'campaign_id',
  'updated_time',
  `creative{${CREATIVE_GRAPH_FIELDS}}`,
].join(',');

/** Campos leves para listagem de ads numa campanha (thumbnail/capa). */
const LIVE_AD_FIELDS = [
  'id',
  'name',
  'status',
  `creative{${CREATIVE_GRAPH_FIELDS}}`,
].join(',');

const META_IMPORT_PIPELINE_LABEL = 'meta_creative_import';

/** Chave mensal consumida ao importar 1 anúncio/criativo (analítica). */
function creativeImportMetricKey() {
  return (
    process.env.USAGE_META_CREATIVE_IMPORT_KEY ||
    process.env.USAGE_META_CAMPAIGN_IMPORT_KEY ||
    'meta_creative_import_month'
  ).trim();
}

/** @deprecated Use creativeImportMetricKey */
function campaignImportMetricKey() {
  return creativeImportMetricKey();
}

/** Janela padrão de insights na importação (dias até hoje UTC, inclusive extremos). */
function defaultInsightsLookbackDays() {
  const fromAd = process.env.META_AD_IMPORT_INSIGHT_DAYS;
  const fromLegacy = process.env.META_CAMPAIGN_IMPORT_INSIGHT_DAYS;
  const raw =
    fromAd !== undefined && fromAd !== ''
      ? fromAd
      : fromLegacy !== undefined && fromLegacy !== ''
        ? fromLegacy
        : '31';
  return Math.min(366, Math.max(7, Number(raw)));
}

function monthlyPeriodLabelUtc(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripActPrefix(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const n = s.startsWith('act_') ? s.slice(4) : s;
  return n.replace(/\s+/g, '');
}

function actGraphPrefix(raw) {
  const digits = stripActPrefix(raw);
  if (!digits) return '';
  return `act_${digits}`;
}

/** Corresponder `meta_ad_accounts.meta_act_id` armazenado com ou sem prefixo `act_`. */
function metaActMatchesColumn(stored, requestedRaw) {
  const a = String(stored || '').trim();
  const bDigits = stripActPrefix(requestedRaw);
  if (!bDigits || !a) return false;
  const aDigits = stripActPrefix(a);
  return aDigits === bDigits;
}

async function resolveMetaAccountForOrg(organizationId, metaActIdFromRoute) {
  const digits = stripActPrefix(metaActIdFromRoute);
  if (!digits) {
    const err = new Error('invalid_meta_act_id');
    err.statusCode = 400;
    throw err;
  }

  const rows = await db.MetaAdAccount.findAll({
    where: {
      organizationId,
      metaActId: {
        [Op.or]: [{ [Op.eq]: digits }, { [Op.eq]: `act_${digits}` }],
      },
    },
    limit: 2,
  });

  let row =
    rows.find((r) => metaActMatchesColumn(r.metaActId, metaActIdFromRoute)) || rows[0];
  if (!row) {
    row = await db.MetaAdAccount.create({
      organizationId,
      metaActId: `act_${digits}`,
      name: `Conta Meta ${digits}`,
      status: 'active',
    });
  }
  return row;
}

async function hydrateCreative(accessToken, creativeThing) {
  if (!creativeThing) return {};
  if (typeof creativeThing === 'object') {
    const id = creativeThing.id ? String(creativeThing.id) : null;
    if (id && !creativeThing.video_id && !creativeThing.object_story_spec) {
      try {
        return await graph.fbGet(accessToken, id, {
          fields: CREATIVE_GRAPH_FIELDS,
        });
      } catch (_) {
        return creativeThing;
      }
    }
    return creativeThing;
  }
  if (typeof creativeThing === 'string' && creativeThing.trim()) {
    return await graph.fbGet(accessToken, creativeThing.trim(), {
      fields: CREATIVE_GRAPH_FIELDS,
    });
  }
  return {};
}

function pickThumbnailFromCreative(creativeObj) {
  const c = creativeObj && typeof creativeObj === 'object' ? creativeObj : {};
  if (c.thumbnail_url) return String(c.thumbnail_url);
  if (c.image_url) return String(c.image_url);
  const spec = c.object_story_spec;
  if (spec && typeof spec === 'object') {
    if (spec.link_data && spec.link_data.picture) return String(spec.link_data.picture);
    if (spec.video_data && spec.video_data.image_url)
      return String(spec.video_data.image_url);
  }
  return null;
}

function extractCreativeAndVideoIds(creativeObj) {
  const parsed = metaCreativeParser.parseAdCreativeForStorage(creativeObj);
  const c = creativeObj && typeof creativeObj === 'object' ? creativeObj : {};
  const creativeId = c.id != null ? String(c.id) : parsed.metaCreativeId;
  const videoId = parsed.videoId;
  return { creativeId: creativeId || null, videoId: videoId || null };
}

function pickPurchaseRoas(row) {
  if (!row || typeof row !== 'object') return null;
  const pr = row.purchase_roas;
  if (Array.isArray(pr) && pr.length) {
    const hit =
      pr.find((x) => x && typeof x.value === 'string' && Number(x.value) >= 0) ||
      pr.find((x) => x && typeof x.value === 'number') ||
      pr[0];
    if (hit && hit.value !== undefined && hit.value !== null) {
      const n = Number(hit.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  if (typeof row.roas === 'number' || typeof row.roas === 'string') {
    const n = Number(row.roas);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `yyyy-mm-dd` */
function isoDateOk(s, label) {
  if (!s || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`invalid_date_${label || 'unknown'}`);
    err.statusCode = 400;
    throw err;
  }
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) {
    const err = new Error(`invalid_calendar_date:${label || 'unknown'}`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function utcYmd(daysOffsetFromUtcMidnight = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(daysOffsetFromUtcMidnight));
  return d.toISOString().slice(0, 10);
}

function defaultInsightsBounds() {
  const days = defaultInsightsLookbackDays();
  const until = utcYmd(-1);
  const sinceDt = new Date(`${until}T00:00:00Z`);
  sinceDt.setUTCDate(sinceDt.getUTCDate() - (days - 1));
  const since = sinceDt.toISOString().slice(0, 10);
  return { since, until };
}

/**
 * Consome um crédito mensal por novo criativo/anúncio importado (exceto bypass Super Admin).
 * @returns {Promise<boolean>} `true` se incrementou o contador; `false` se bypass ignorou uso.
 */
async function consumeCreativeImportCredit(organizationId, actingUserProfile) {
  const { limits } = await planLimits.getResolvedLimitsForOrganization(
    organizationId,
    actingUserProfile,
  );
  const limit = planLimits.creativeImportLimitFromResolved(limits);

  if (limit === Number.POSITIVE_INFINITY) {
    return false;
  }

  await db.sequelize.transaction(async (t) => {
    const metricKey = creativeImportMetricKey();
    const periodLabel = monthlyPeriodLabelUtc();

    let counter = await db.UsageCounter.findOne({
      transaction: t,
      lock: t.UPDATE,
      where: { organizationId, metricKey, periodLabel },
    });

    const used = counter ? counter.value : 0;
    if (used >= limit) {
      const err = new Error('meta_creative_import_quota_exceeded');
      err.statusCode = 429;
      err.quotaHint = {
        metricKey,
        periodLabel,
        used,
        limit,
      };
      throw err;
    }

    if (!counter) {
      await db.UsageCounter.create(
        {
          organizationId,
          metricKey,
          periodLabel,
          value: 1,
        },
        { transaction: t },
      );
    } else {
      await counter.increment('value', { by: 1, transaction: t });
    }

    console.info('[metasync] creative_import_credit_consumed', {
      organizationId,
      metricKey,
      periodLabel,
      usedBefore: used,
      limit,
    });
  });

  return true;
}

async function refundCreativeImportCredit(organizationId) {
  try {
    await db.sequelize.transaction(async (t) => {
      const metricKey = creativeImportMetricKey();
      const periodLabel = monthlyPeriodLabelUtc();
      const counter = await db.UsageCounter.findOne({
        transaction: t,
        lock: t.UPDATE,
        where: { organizationId, metricKey, periodLabel },
      });
      if (counter && counter.value > 0) {
        await counter.decrement('value', { by: 1, transaction: t });
        console.warn('[metasync] creative_import_credit_refunded_after_failure', {
          organizationId,
          metricKey,
          periodLabel,
        });
      }
    });
  } catch (e) {
    console.error('[metasync] refund_credit_failed', e.message);
  }
}

async function ensureMediaClaimAndEnqueueIfNew({
  organizationId,
  adPk,
  metaAdIdStr,
  metaVideoId,
  thumbnailUrl = null,
  objectType = null,
  accessToken,
  actingUserProfile = null,
}) {
  const existing = await db.MediaAsset.findOne({ where: { metaVideoId } });
  if (existing) {
    const currentMeta =
      existing.ingestMetadata && typeof existing.ingestMetadata === 'object'
        ? existing.ingestMetadata
        : {};
    const nextMeta = { ...currentMeta };
    if (metaAdIdStr && !nextMeta.metaAdGraphId) {
      nextMeta.metaAdGraphId = metaAdIdStr;
    }
    if (thumbnailUrl && !nextMeta.thumbnailUrl) {
      nextMeta.thumbnailUrl = thumbnailUrl;
    }
    if (objectType && !nextMeta.objectType) {
      nextMeta.objectType = objectType;
    }
    if (accessToken && metaVideoId && !nextMeta.nativeFormat?.width) {
      try {
        const vhead = await graph.fbGet(accessToken, String(metaVideoId), {
          fields: 'length,format',
        });
        const native = creativeFormat.extractNativeFormatFromVideoPayload(vhead);
        if (native.width) nextMeta.width = native.width;
        if (native.height) nextMeta.height = native.height;
        if (native.filter) nextMeta.formatFilter = native.filter;
        if (native.length != null) nextMeta.videoLength = native.length;
        nextMeta.nativeFormat = native;
      } catch (_) {
        /** best-effort */
      }
    }
    if (JSON.stringify(nextMeta) !== JSON.stringify(currentMeta)) {
      await existing.update({ ingestMetadata: nextMeta });
    }

    await db.OrganizationMediaClaim.findOrCreate({
      where: { organizationId, mediaId: existing.id },
      defaults: {
        source: META_IMPORT_PIPELINE_LABEL,
        claimMetadata: { syncedFromMetaAdId: metaAdIdStr },
      },
    });
    return { mediaId: existing.id, enqueued: false, existed: true };
  }

  let graphVideoLength = null;
  let nativeFormat = { width: null, height: null, filter: null, length: null };
  if (accessToken && metaVideoId) {
    try {
      /** @type {object} */
      const vhead = await graph.fbGet(accessToken, String(metaVideoId), {
        fields: 'length,format',
      });
      nativeFormat = creativeFormat.extractNativeFormatFromVideoPayload(vhead);
      if (nativeFormat.length != null) graphVideoLength = Number(nativeFormat.length);
    } catch (_) {
      /** falha silenciosa — worker usará outros sinais. */
    }
  }

  const media = await db.MediaAsset.create({
    metaVideoId,
    googleDriveFileId: null,
    processingStatus: 'ingest',
    ingestMetadata: {
      discoveredViaMetaCreativeImport: true,
      metaAdGraphId: metaAdIdStr,
      organizationHint: organizationId,
      thumbnailUrl: thumbnailUrl || null,
      objectType: objectType || null,
      width: nativeFormat.width,
      height: nativeFormat.height,
      formatFilter: nativeFormat.filter,
      videoLength: nativeFormat.length,
      nativeFormat,
      graphVideoLengthSeconds:
        Number.isFinite(graphVideoLength) && graphVideoLength > 0 ? graphVideoLength : null,
    },
  });

  await db.OrganizationMediaClaim.create({
    organizationId,
    mediaId: media.id,
    source: META_IMPORT_PIPELINE_LABEL,
    claimMetadata: { syncedFromMetaAdId: metaAdIdStr },
  });

  const actingUserSnapshot =
    actingUserProfile && (actingUserProfile.email || actingUserProfile.roles?.length)
      ? {
          email: actingUserProfile.email,
          roles: Array.isArray(actingUserProfile.roles) ? actingUserProfile.roles : [],
        }
      : null;

  const job = await enqueueVideoAnalyzeJob({
    organizationId,
    mediaId: media.id,
    adId: adPk,
    requestedAt: new Date().toISOString(),
    sourcePipeline: META_IMPORT_PIPELINE_LABEL,
    actingUserSnapshot,
  });

  await media.update({
    processingStatus: 'queued_video',
    ingestMetadata: {
      ...media.ingestMetadata,
      analyzeRequestedAt: new Date().toISOString(),
      lastQueuedJobId: job.id,
    },
  });

  return { mediaId: media.id, enqueued: true, existed: false, jobId: job.id };
}

function safeBigIntishToNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.trunc(n), 0), Number.MAX_SAFE_INTEGER);
}

async function upsertPerformanceRow({ organizationId, adPk, row }) {
  const dateRaw = row.date_start || row.date_stop;
  if (!dateRaw) return;

  const snapshotDate = isoDateOk(String(dateRaw).slice(0, 10), 'snapshot_date');
  const impressions = row.impressions != null ? safeBigIntishToNumber(row.impressions) : null;
  const clicks = row.clicks != null ? safeBigIntishToNumber(row.clicks) : null;
  const spendNum = row.spend != null ? Number(row.spend) : null;
  const ctrNum = row.ctr != null ? Number(row.ctr) : null;
  const roasNum = pickPurchaseRoas(row);

  const mergedJson = {
    raw: row,
    normalized: { impressions, clicks, spend: spendNum, ctr: ctrNum, roas: roasNum },
    pulledAtUtc: new Date().toISOString(),
    sourcePipeline: META_IMPORT_PIPELINE_LABEL,
  };

  const existing = await db.AdPerformanceDaily.findOne({
    where: { organizationId, adId: adPk, snapshotDate },
  });

  const payloadAttrs = {
    metricsJsonb: mergedJson,
    impressions: impressions != null ? impressions : null,
    clicks: clicks != null ? clicks : null,
    spend: spendNum != null ? spendNum : null,
    ctr: ctrNum != null ? ctrNum : null,
    roas: roasNum != null ? roasNum : null,
  };

  if (existing) await existing.update(payloadAttrs);
  else {
    await db.AdPerformanceDaily.create({
      organizationId,
      adId: adPk,
      snapshotDate,
      ...payloadAttrs,
    });
  }
}

async function fetchCampaignHead(accessToken, metaCampaignGraphId) {
  /** @type {object} */
  const head = await graph.fbGet(accessToken, String(metaCampaignGraphId).trim(), {
    fields: 'id,name,account_id,status',
  });
  return head || {};
}

function campaignMatchesAct(head, metaActDigits) {
  const ac = head.account_id ? String(head.account_id) : '';
  return stripActPrefix(ac) === String(metaActDigits);
}

async function introspectQuotaForFrontend(
  organizationId,
  actingUserProfile = null,
) {
  const metricKey = creativeImportMetricKey();
  const periodLabel = monthlyPeriodLabelUtc();

  const resolved = await planLimits.getResolvedLimitsForOrganization(
    organizationId,
    actingUserProfile,
  );

  /** @type {object} */
  const limitsPayload = resolved.limits;

  let used = 0;
  let counterRow = await db.UsageCounter.findOne({
    where: { organizationId, metricKey, periodLabel },
  }).catch(() => null);
  if (counterRow) used = Number(counterRow.value || 0);

  const rawLimit =
    resolved.limitless ?
      Number.POSITIVE_INFINITY
    : planLimits.creativeImportLimitFromResolved(resolved.limits);

  const remaining =
    rawLimit === Number.POSITIVE_INFINITY ? null : Math.max(0, rawLimit - used);

  return {
    metricKey,
    periodLabel,
    used,
    limit: rawLimit === Number.POSITIVE_INFINITY ? null : rawLimit,
    remaining,
    planTierKey: resolved.tierKey,
    limitless: resolved.limitless,
    entitlementSource: resolved.source,
    limits: limitsPayload,
    transcriptionMinutesKey: transcriptionUsage.transcriptionMinutesMetricKey(),
    transcriptionMinutesLabel: transcriptionUsage.monthlyPeriodLabelUtc(),
  };
}

async function syncDailyPerformanceInternal(organizationId, adPkUuid, since, until) {
  const adRow = await db.Ad.findOne({
    where: { id: adPkUuid, organizationId },
  });
  if (!adRow) {
    const err = new Error('ad_not_found');
    err.statusCode = 404;
    throw err;
  }

  const { accessToken } = await metaService.getValidToken(organizationId, { preferOrgToken: true });

  const timeRange = JSON.stringify({ since, until });
  const rows = await graph.iterateAllEdges(
    accessToken,
    `${adRow.metaAdId}/insights`,
    {
      fields: INSIGHT_FIELDS,
      time_increment: 1,
      time_range: timeRange,
      limit: GRAPH_PAGE_LIMIT,
    },
  );

  let daysWritten = 0;
  for (const raw of rows) {
    await upsertPerformanceRow({ organizationId, adPk: adRow.id, row: raw });
    daysWritten += 1;
  }

  return { adId: adRow.id, metaAdId: adRow.metaAdId, insightRows: rows.length, daysWritten };
}

/**
 * Lista contas de anúncio Meta acessíveis via OAuth da org (Graph `me/adaccounts`).
 * Persiste/atualiza registros em `meta_ad_accounts` para reutilização nas rotas de import.
 */
async function listAdAccounts(organizationId) {
  const { accessToken } = await metaService.getValidToken(organizationId, { preferOrgToken: true });
  const rows = await graph.iterateAllEdges(accessToken, 'me/adaccounts', {
    fields: 'id,name,account_status',
    limit: GRAPH_PAGE_LIMIT,
  });

  const items = [];
  for (const row of rows) {
    const metaActId = actGraphPrefix(row.id);
    const name =
      row.name != null && String(row.name).trim()
        ? String(row.name).trim()
        : `Conta Meta ${stripActPrefix(metaActId)}`;

    const existing = await db.MetaAdAccount.findOne({
      where: { organizationId, metaActId },
    });
    if (existing) {
      if (existing.name !== name) {
        await existing.update({ name });
      }
    } else {
      await db.MetaAdAccount.create({ organizationId, metaActId, name });
    }

    items.push({
      id: stripActPrefix(metaActId),
      metaActId,
      name,
      accountStatus:
        row.account_status != null ? Number(row.account_status) : null,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return items;
}

/**
 * Lista leve (sem persistência) das campanhas da conta Meta vinculada à org.
 */
async function listLiveCampaigns(organizationId, metaActIdFromRoute) {
  const metaAccount = await resolveMetaAccountForOrg(organizationId, metaActIdFromRoute);
  const { accessToken } = await metaService.getValidToken(organizationId, { preferOrgToken: true });
  const act = actGraphPrefix(metaActIdFromRoute);
  const items = await graph.iterateAllEdges(accessToken, `${act}/campaigns`, {
    fields: LIVE_CAM_FIELDS,
    limit: GRAPH_PAGE_LIMIT,
  });

  const graphIds = items.map((c) => String(c.id));
  /** @type {Set<string>} */
  const imported = new Set();
  if (graphIds.length > 0) {
    const dbRows = await db.Campaign.findAll({
      where: {
        organizationId,
        metaAdAccountId: metaAccount.id,
        metaCampaignId: { [Op.in]: graphIds },
      },
      attributes: ['metaCampaignId'],
    });
    for (const r of dbRows) imported.add(String(r.metaCampaignId));
  }

  return items.map((c) => ({
    id: String(c.id),
    name: c.name != null ? String(c.name) : String(c.id),
    status: c.status != null ? String(c.status) : null,
    is_imported: imported.has(String(c.id)),
  }));
}

/**
 * Lista anúncios “live” de uma campanha no Graph API (preview/thumbnail quando disponível).
 * Cruza com `ads` da org ⇒ `is_imported`.
 */
async function listLiveAdsByCampaign(
  organizationId,
  metaActIdFromRoute,
  metaCampaignGraphId,
) {
  const metaAccount = await resolveMetaAccountForOrg(organizationId, metaActIdFromRoute);
  const { accessToken } = await metaService.getValidToken(organizationId, { preferOrgToken: true });
  const digits = stripActPrefix(metaAccount.metaActId);

  /** @type {object} */
  const head = await fetchCampaignHead(accessToken, metaCampaignGraphId);
  const metaCampaignNorm = head.id ? String(head.id) : String(metaCampaignGraphId).trim();
  if (!campaignMatchesAct(head, digits)) {
    const err = new Error('campaign_does_not_belong_to_linked_meta_act');
    err.statusCode = 403;
    throw err;
  }

  const items = await graph.iterateAllEdges(accessToken, `${metaCampaignNorm}/ads`, {
    fields: LIVE_AD_FIELDS,
    limit: GRAPH_PAGE_LIMIT,
  });

  const graphAdIds = items.map((a) => String(a.id));
  /** @type {Set<string>} */
  const imported = new Set();
  if (graphAdIds.length > 0) {
    const dbAds = await db.Ad.findAll({
      where: { organizationId, metaAdId: { [Op.in]: graphAdIds } },
      attributes: ['metaAdId'],
    });
    for (const r of dbAds) imported.add(String(r.metaAdId));
  }

  const rows = [];
  for (const ad of items) {
    const hydrated = await hydrateCreative(accessToken, ad.creative);
    const thumbnailUrl = pickThumbnailFromCreative(hydrated);
    const { videoId } = extractCreativeAndVideoIds(hydrated);
    const metaAdGraphId = String(ad.id);
    rows.push({
      id: metaAdGraphId,
      name: ad.name != null ? String(ad.name) : metaAdGraphId,
      status: ad.status != null ? String(ad.status) : null,
      thumbnail_url: thumbnailUrl,
      has_video_id: Boolean(videoId),
      is_imported: imported.has(metaAdGraphId),
    });
  }
  return rows;
}

async function ingestSingleAdHierarchy({
  organizationId,
  metaAccountRecord,
  accessToken,
  metaCampaignGraphIdExpected,
  metaAdGraphId,
  actingUserProfile = null,
}) {
  const digits = stripActPrefix(metaAccountRecord.metaActId);

  /** @type {object} */
  const adObj = await graph.fbGet(accessToken, String(metaAdGraphId).trim(), {
    fields: AD_FIELDS,
  });
  if (!adObj || !adObj.id) {
    const err = new Error('meta_ad_not_found_or_inaccessible');
    err.statusCode = 404;
    throw err;
  }

  const metaAdNorm = String(adObj.id);
  const campFromAd = adObj.campaign_id ? String(adObj.campaign_id) : null;
  const adsetFromAd = adObj.adset_id ? String(adObj.adset_id) : null;
  if (!campFromAd || campFromAd !== String(metaCampaignGraphIdExpected).trim()) {
    const err = new Error('ad_does_not_belong_to_campaign');
    err.statusCode = 400;
    throw err;
  }
  if (!adsetFromAd) {
    const err = new Error('meta_ad_missing_adset');
    err.statusCode = 422;
    throw err;
  }

  const head = await fetchCampaignHead(accessToken, campFromAd);
  const metaCampaignGraphIdNormalized = head.id ? String(head.id) : campFromAd;
  if (!campaignMatchesAct(head, digits)) {
    const err = new Error('campaign_does_not_belong_to_linked_meta_act');
    err.statusCode = 403;
    throw err;
  }

  let campaignRow = await db.Campaign.findOne({
    where: {
      metaAdAccountId: metaAccountRecord.id,
      metaCampaignId: metaCampaignGraphIdNormalized,
    },
  });

  const now = new Date();
  const camAttr = {
    organizationId,
    metaAdAccountId: metaAccountRecord.id,
    metaCampaignId: metaCampaignGraphIdNormalized,
    name: head.name != null ? String(head.name) : metaCampaignGraphIdNormalized,
  };
  campaignRow = campaignRow || (await db.Campaign.create(camAttr));
  await campaignRow.update(camAttr);

  /** @type {object} */
  const asHead = await graph.fbGet(accessToken, adsetFromAd, { fields: ADSET_FIELDS });
  if (!asHead || !asHead.id) {
    const err = new Error('meta_adset_not_found');
    err.statusCode = 404;
    throw err;
  }
  const asCampaignGraph = asHead.campaign_id ? String(asHead.campaign_id) : null;
  if (asCampaignGraph !== metaCampaignGraphIdNormalized) {
    const err = new Error('adset_campaign_mismatch');
    err.statusCode = 400;
    throw err;
  }

  const metaAdsetId = String(asHead.id);
  let adSetRow = await db.AdSet.findOne({
    where: { organizationId, metaAdsetId },
  });

  const adSetAttr = {
    organizationId,
    campaignId: campaignRow.id,
    metaAdsetId,
    name: asHead.name != null ? String(asHead.name) : metaAdsetId,
  };
  if (!adSetRow) {
    adSetRow = await db.AdSet.create(adSetAttr);
  } else {
    await adSetRow.update(adSetAttr);
  }

  const hydrated = await hydrateCreative(accessToken, adObj.creative);
  const parsedCreative = metaCreativeParser.parseAdCreativeForStorage(hydrated);
  const { creativeId, videoId } = extractCreativeAndVideoIds(hydrated);
  const thumbnailUrl = pickThumbnailFromCreative(hydrated);
  const objectType =
    hydrated && hydrated.object_type != null ? String(hydrated.object_type) : null;

  let adRow = await db.Ad.findOne({
    where: { organizationId, metaAdId: metaAdNorm },
  });

  const adAttr = {
    organizationId,
    adSetId: adSetRow.id,
    metaAdId: metaAdNorm,
    name: adObj.name ? String(adObj.name) : metaAdNorm,
    lastSyncedAt: now,
    metaCreativeId: creativeId,
    metaVideoId: videoId,
    primaryText: parsedCreative.primaryText,
    headline: parsedCreative.headline,
    ctaType: parsedCreative.ctaType,
    isDynamicCreative: parsedCreative.isDynamicCreative,
    rawCreativeData: parsedCreative.rawCreativeData,
  };

  if (!adRow) {
    adRow = await db.Ad.create(adAttr);
  } else {
    await adRow.update(adAttr);
  }

  let newMetaVideosQueued = 0;
  if (videoId) {
    const res = await ensureMediaClaimAndEnqueueIfNew({
      organizationId,
      adPk: adRow.id,
      metaAdIdStr: metaAdNorm,
      metaVideoId: videoId,
      thumbnailUrl,
      objectType,
      accessToken,
      actingUserProfile,
    });
    if (res.enqueued) newMetaVideosQueued += 1;
  }

  return {
    metaCampaignGraphId: metaCampaignGraphIdNormalized,
    campaignDbId: campaignRow.id,
    metaAdId: metaAdNorm,
    adDbId: adRow.id,
    newMetaVideosQueued,
  };
}

async function insightsForAdsImported(organizationId, adPkIds, since, until) {
  let totalRows = 0;
  /** @type {Record<string,{insightRows:number,daysWritten:number}>} */
  const perAd = {};
  for (const adPk of adPkIds) {
    const chunk = await syncDailyPerformanceInternal(organizationId, adPk, since, until);
    perAd[String(adPk)] = {
      insightRows: chunk.insightRows,
      daysWritten: chunk.daysWritten,
    };
    totalRows += chunk.insightRows || 0;
  }
  return { totalInsightApiRows: totalRows, detailByAdId: perAd };
}

async function importAndAnalyzeAd({
  organizationId,
  metaActIdFromRoute,
  metaCampaignGraphId,
  metaAdGraphId,
  insightsSince,
  insightsUntil,
  actingUserProfile = null,
}) {
  if (!organizationId || !UUID.test(String(organizationId))) {
    const err = new Error('invalid_organization');
    err.statusCode = 400;
    throw err;
  }

  let chargedCreativeImportCredit = false;

  const metaAccountRecord = await resolveMetaAccountForOrg(
    organizationId,
    metaActIdFromRoute,
  );
  const { accessToken } = await metaService.getValidToken(organizationId, { preferOrgToken: true });

  const metaNorm = String(metaAdGraphId).trim();
  const existingAd = await db.Ad.findOne({
    where: { organizationId, metaAdId: metaNorm },
  });

  /** Re-sync gratuito quando o anúncio já existe nesta org. */
  if (!existingAd) {
    chargedCreativeImportCredit = await consumeCreativeImportCredit(
      organizationId,
      actingUserProfile,
    );
  }

  try {
    const boundsDefault = defaultInsightsBounds();
    const sinceBound = isoDateOk(
      String(insightsSince || boundsDefault.since),
      'insightsSince',
    );
    const untilBound = isoDateOk(
      String(insightsUntil || boundsDefault.until),
      'insightsUntil',
    );
    if (Date.parse(`${sinceBound}T00:00:00Z`) > Date.parse(`${untilBound}T00:00:00Z`)) {
      const err = new Error('insights_date_range_inverted');
      err.statusCode = 400;
      throw err;
    }

    const structure = await ingestSingleAdHierarchy({
      organizationId,
      metaAccountRecord,
      accessToken,
      metaCampaignGraphIdExpected: metaCampaignGraphId,
      metaAdGraphId,
      actingUserProfile,
    });

    const insightsAgg = await insightsForAdsImported(
      organizationId,
      [structure.adDbId],
      sinceBound,
      untilBound,
    );

    const quotaSnapshot = await introspectQuotaForFrontend(
      organizationId,
      actingUserProfile,
    );

    return {
      ok: true,
      chargedCreativeImportCredit,
      reSyncSkippedCredit: !chargedCreativeImportCredit,
      quota: quotaSnapshot,
      structure,
      insights: {
        ...insightsAgg,
        since: sinceBound,
        until: untilBound,
      },
    };
  } catch (error) {
    if (chargedCreativeImportCredit) {
      await refundCreativeImportCredit(organizationId);
    }
    throw error;
  }
}

module.exports = {
  listAdAccounts,
  listLiveCampaigns,
  listLiveAdsByCampaign,
  importAndAnalyzeAd,
  introspectQuotaForFrontend,
  syncDailyPerformanceInternal,
  creativeImportMetricKey,
  campaignImportMetricKey,
  META_IMPORT_PIPELINE_LABEL,
  stripActPrefix,
  actGraphPrefix,
};
