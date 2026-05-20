'use strict';

const axios = require('axios');

function graphRoot() {
  const v = process.env.META_GRAPH_API_VERSION || 'v25.0'; // Default para v25.0 conforme documentação de fev/2026
  const vn = String(v).startsWith('v') ? v : `v${v}`;
  return `https://graph.facebook.com/${vn}`;
}

const META_REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS || 60000);
const META_MAX_PAGES = Number(process.env.META_SYNC_MAX_PAGES || 500);
const META_MAX_GRAPH_RETRIES = Number(process.env.META_GRAPH_MAX_RETRIES || 6);

function jitterMs(upTo = 500) {
  return Math.floor(Math.random() * upTo);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MetaRateLimitManager {
  constructor(warnThresholdPct = 75) {
    this.warnThreshold = warnThresholdPct;
  }

  /**
   * Parseia os headers de rate limit da Meta
   */
  parseHeaders(headers) {
    if (!headers) return { ok: true, shouldBackOff: false, waitMinutes: 0 };
    
    const bucHeader = headers['x-business-use-case-usage'];
    const insightsHeader = headers['x-fb-ads-insights-throttle'];
    const appHeader = headers['x-app-usage'];

    let status = { ok: true, shouldBackOff: false, waitMinutes: 0 };

    if (bucHeader) {
      try {
        const buc = JSON.parse(bucHeader);
        const firstAccount = Object.values(buc)[0]?.[0];
        if (firstAccount) {
          const maxPct = Math.max(
            Number(firstAccount.call_count || 0),
            Number(firstAccount.total_cputime || 0),
            Number(firstAccount.total_time || 0)
          );
          status.callCountPct = firstAccount.call_count;
          status.cpuTimePct = firstAccount.total_cputime;
          status.totalTimePct = firstAccount.total_time;
          status.waitMinutes = Number(firstAccount.estimated_time_to_regain_access || 0);
          status.shouldBackOff = maxPct >= this.warnThreshold;
          status.ok = status.waitMinutes === 0;
        }
      } catch (_) { /* ignore */ }
    }

    if (insightsHeader) {
      try {
        const ins = JSON.parse(insightsHeader);
        status.insightsAppPct = Number(ins.app_id_util_pct || 0);
        status.insightsAccPct = Number(ins.acc_id_util_pct || 0);
        status.accessTier = ins.ads_api_access_tier;
        if (status.insightsAppPct >= this.warnThreshold || status.insightsAccPct >= this.warnThreshold) {
          status.shouldBackOff = true;
        }
      } catch (_) { /* ignore */ }
    }

    if (appHeader && !bucHeader) {
      try {
        const app = JSON.parse(appHeader);
        const maxPct = Math.max(
          Number(app.call_count || 0),
          Number(app.total_cputime || 0),
          Number(app.total_time || 0)
        );
        status.shouldBackOff = maxPct >= this.warnThreshold;
      } catch (_) { /* ignore */ }
    }

    return status;
  }

  /**
   * Wrapper robusto com retry e backoff exponencial base para requisições
   */
  async requestWithRetry(fn, maxRetries = META_MAX_GRAPH_RETRIES) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fn();
        
        // Tratar status HTTP mapeados pelo Axios se validateStatus permitir
        if (response.status && (response.status < 200 || response.status >= 300)) {
          const errorBody = response.data || {};
          const err = new Error(errorBody.error?.message || `meta_graph_http_${response.status}`);
          err.statusCode = response.status;
          err.metaFb = errorBody.error || errorBody;
          throw err;
        }

        const rl = this.parseHeaders(response.headers);

        if (rl.shouldBackOff && rl.waitMinutes > 0) {
          console.warn(`[MetaRateLimit] Limite atingido. Aguardando ${rl.waitMinutes} minutos preventivamente...`);
          await sleep(rl.waitMinutes * 60 * 1000 + jitterMs(2000));
        } else if (rl.shouldBackOff) {
          console.warn(`[MetaRateLimit] Cota próxima do aviso. Dormindo 15s preventivamente...`);
          await sleep(15000 + jitterMs(1000));
        }

        // Se o axios foi instanciado diretamente, devolve o payload data ou o response todo
        return response;
      } catch (err) {
        const statusCode = err.statusCode || err.response?.status;
        const errorBody = err.metaFb || err.response?.data?.error || {};
        const errorCode = Number(errorBody.code || 0);

        const isRateLimit = 
          statusCode === 429 || 
          [4, 17, 32, 613, 80000, 80003, 80004].includes(errorCode) ||
          /rate|limit|throttle/i.test(err.message || '');

        if (isRateLimit && attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt + 1) * 3000 + jitterMs(1000); // 6s, 12s, 24s...
          console.warn(`[MetaRateLimit] Bloqueio/Rate Limit ativo (Code ${errorCode}). Retrying em ${backoffMs / 1000}s (Tentativa ${attempt + 1}/${maxRetries})...`);
          await sleep(backoffMs);
          continue;
        }
        throw err;
      }
    }
    throw new Error('meta_graph_exhausted_retries');
  }
}

const rlManager = new MetaRateLimitManager(75);

/**
 * Método GET primário compatível com a base antiga, mas reforçado com Rate Limiting
 */
async function fbGet(accessToken, relativeNoLeadingSlash, params) {
  const base = `${graphRoot()}/${relativeNoLeadingSlash.replace(/^\//, '')}`;
  
  const execution = () => axios.get(base, {
    params: { ...(params || {}), access_token: accessToken },
    timeout: META_REQUEST_TIMEOUT_MS,
    validateStatus: () => true, // Capturado pelo RateLimitManager
  });

  const res = await rlManager.requestWithRetry(execution);
  return res.data;
}

/**
 * Itera coleções da Graph API (ex: act_123/campaigns) tratando paginação por cursor.
 */
async function iterateAllEdges(accessToken, relative, params) {
  const cleaned = relative.replace(/^\//, '');
  let nextUrl = null;
  const collected = [];
  let page = 0;

  while (page < META_MAX_PAGES) {
    const execution = () => {
      if (nextUrl === null) {
        const base = `${graphRoot()}/${cleaned}`;
        return axios.get(base, {
          params: { ...(params || {}), access_token: accessToken },
          timeout: META_REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        });
      } else {
        const sep = nextUrl.includes('?') ? '&' : '?';
        const url = nextUrl.includes('access_token=')
          ? nextUrl
          : `${nextUrl}${sep}access_token=${encodeURIComponent(accessToken)}`;
        return axios.get(url.replace(/^http:/i, 'https:'), {
          timeout: META_REQUEST_TIMEOUT_MS,
          validateStatus: () => true,
        });
      }
    };

    const res = await rlManager.requestWithRetry(execution);
    const payload = res.data || {};
    const chunk = Array.isArray(payload.data) ? payload.data : [];
    
    for (const row of chunk) {
      collected.push(row);
    }

    nextUrl = payload.paging && payload.paging.next ? String(payload.paging.next) : null;
    if (!nextUrl) break;
    
    page += 1;
    await sleep(200 + jitterMs(100)); // Pequeno delay preventivo entre páginas
  }

  return collected;
}

/**
 * Helper para extrair ROAS e valores de compra normalizados de um dia de insights
 */
function parseInsightsMetrics(insightDay) {
  const spend = parseFloat(insightDay.spend || '0');
  const impressions = parseInt(insightDay.impressions || '0', 10);
  const clicks = parseInt(insightDay.clicks || '0', 10);
  const ctr = parseFloat(insightDay.ctr || '0');

  // Buscar omni_purchase ou website_purchase
  const roasEntry = (insightDay.purchase_roas || []).find(
    (a) => ['omni_purchase', 'website_purchase'].includes(a.action_type)
  );
  const roas = roasEntry ? parseFloat(roasEntry.value) : 0;

  // Receita total de compras
  const revenueEntry = (insightDay.action_values || []).find(
    (a) => ['purchase', 'omni_purchase'].includes(a.action_type)
  );
  const revenue = revenueEntry ? parseFloat(revenueEntry.value) : 0;

  // Quantidade física de compras
  const purchasesEntry = (insightDay.actions || []).find(
    (a) => ['purchase', 'omni_purchase'].includes(a.action_type)
  );
  const purchases = purchasesEntry ? parseInt(purchasesEntry.value, 10) : 0;

  return { spend, impressions, clicks, ctr, roas, revenue, purchases };
}

/**
 * Busca dados de criativo + insights diários agregados de forma otimizada para a v25.0
 */
async function getAdFullData(adId, accessToken, datePreset = 'last_30d') {
  const CREATIVE_FIELDS = [
    'id', 'name', 'body', 'title',
    'call_to_action_type', 'thumbnail_url', 'image_url', 'video_id',
    'object_story_spec', 'asset_feed_spec',
  ].join(',');

  const INSIGHTS_FIELDS = [
    'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
    'ctr', 'cpc', 'reach', 'frequency',
    'actions', 'action_values', 'purchase_roas', 'cost_per_action_type',
  ].join(',');

  const [creativeData, insightsData] = await Promise.all([
    fbGet(accessToken, String(adId), {
      fields: `id,name,status,creative{${CREATIVE_FIELDS}}`,
    }),
    fbGet(accessToken, `${adId}/insights`, {
      level: 'ad',
      time_increment: 1,
      date_preset: datePreset,
      fields: INSIGHTS_FIELDS,
    })
  ]);

  const creative = creativeData.creative || {};
  const insights = insightsData.data || [];

  const totals = insights.reduce(
    (acc, day) => {
      const parsed = parseInsightsMetrics(day);
      acc.spend += parsed.spend;
      acc.impressions += parsed.impressions;
      acc.clicks += parsed.clicks;
      acc.revenue += parsed.revenue;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, revenue: 0 }
  );

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  return {
    adId,
    creative: {
      id: creative.id,
      body: creative.body
        || creative.object_story_spec?.video_data?.message
        || creative.object_story_spec?.link_data?.message,
      title: creative.title
        || creative.object_story_spec?.video_data?.title
        || creative.object_story_spec?.link_data?.name,
      cta: creative.call_to_action_type,
      thumbnailUrl: creative.thumbnail_url,
      imageUrl: creative.image_url,
      videoId: creative.video_id,
      destinationUrl:
        creative.object_story_spec?.video_data?.call_to_action?.value?.link
        || creative.object_story_spec?.link_data?.link,
    },
    performance: {
      period: datePreset,
      totals,
      daily: insights,
    },
  };
}

module.exports = {
  graphRoot,
  fbGet,
  iterateAllEdges,
  parseInsightsMetrics,
  getAdFullData,
  MetaRateLimitManager,
  rlManager,
};
