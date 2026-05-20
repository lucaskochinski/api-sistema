'use strict';

const axios = require('axios');

function graphRoot() {
  const v = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const vn = String(v).startsWith('v') ? v : `v${v}`;
  return `https://graph.facebook.com/${vn}`;
}

const META_REQUEST_TIMEOUT_MS = Number(process.env.META_GRAPH_TIMEOUT_MS || 60000);
const META_MAX_PAGES = Number(process.env.META_SYNC_MAX_PAGES || 500);
const META_MAX_GRAPH_RETRIES = Number(process.env.META_GRAPH_MAX_RETRIES || 6);

function jitterMs(upTo) {
  return Math.floor(Math.random() * (upTo || 750));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fbErrorIndicatesThrottle(body, statusCode) {
  if (statusCode === 429) return true;
  const err = body && body.error ? body.error : null;
  if (!err) return false;
  const code = Number(err.code);
  const subcode = Number(err.error_subcode);
  if ([4, 17, 32, 613, 80004].includes(code) || subcode === 613) return true;
  const msg = err.message || '';
  if (/rate|limit|throttle/i.test(msg)) return true;
  return false;
}

function backoffDelayMsFromHeaders(headers, attempt) {
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  const sec = raw != null ? Number(raw) : NaN;
  if (!Number.isNaN(sec) && sec > 0 && sec < 3600) {
    return Math.min(900000, sec * 1000 + jitterMs(500));
  }
  return Math.min(120000, 1500 * 2 ** Math.min(attempt, 10) + jitterMs());
}

function mapHttp(st) {
  if (st === 401 || st === 403) return st;
  if (st >= 400 && st < 500) return st;
  return 502;
}

async function fbGet(accessToken, relativeNoLeadingSlash, params) {
  const base = `${graphRoot()}/${relativeNoLeadingSlash.replace(/^\//, '')}`;
  let attempt = 0;
  let last = null;

  while (attempt < META_MAX_GRAPH_RETRIES) {
    try {
      const res = await axios.get(base, {
        params: { ...(params || {}), access_token: accessToken },
        timeout: META_REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });
      last = res;
      if (res.status >= 200 && res.status < 300) return res.data;

      const body = typeof res.data === 'object' && res.data !== null ? res.data : {};
      const throttled =
        fbErrorIndicatesThrottle(body, res.status) || (res.status >= 500 && res.status < 600);

      if (throttled && attempt < META_MAX_GRAPH_RETRIES - 1) {
        const wait = backoffDelayMsFromHeaders(res.headers, attempt);
        console.warn('[meta_graph] throttle_backoff_ms', wait, 'attempt', attempt);
        await sleep(wait);
        attempt += 1;
        continue;
      }

      const err = new Error(body.error?.message || `meta_graph_http_${res.status}`);
      err.statusCode = mapHttp(res.status);
      err.metaFb = body.error || body;
      throw err;
    } catch (e) {
      if (e.metaFb !== undefined || e.statusCode !== undefined) throw e;
      if (attempt < META_MAX_GRAPH_RETRIES - 1) {
        await sleep(backoffDelayMsFromHeaders({}, attempt));
        attempt += 1;
        continue;
      }
      throw e;
    }
  }

  throw new Error(last ? `meta_graph_exhausted_${last.status}` : 'meta_graph_exhausted');
}

async function axiosGetFullPagingUrl(accessToken, fullHttpsUrl) {
  let attempt = 0;
  while (attempt < META_MAX_GRAPH_RETRIES) {
    try {
      const sep = fullHttpsUrl.includes('?') ? '&' : '?';
      const url = fullHttpsUrl.includes('access_token=')
        ? fullHttpsUrl
        : `${fullHttpsUrl}${sep}access_token=${encodeURIComponent(accessToken)}`;

      const res = await axios.get(url.replace(/^http:/i, 'https:'), {
        timeout: META_REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) return res.data;

      const body = typeof res.data === 'object' && res.data !== null ? res.data : {};
      const throttled =
        fbErrorIndicatesThrottle(body, res.status) || (res.status >= 500 && res.status < 600);

      if (throttled && attempt < META_MAX_GRAPH_RETRIES - 1) {
        await sleep(backoffDelayMsFromHeaders(res.headers, attempt));
        attempt += 1;
        continue;
      }

      const err = new Error(body.error?.message || `meta_graph_http_${res.status}`);
      err.statusCode = mapHttp(res.status);
      err.metaFb = body.error || body;
      throw err;
    } catch (e) {
      if (e.metaFb !== undefined || e.statusCode !== undefined) throw e;
      if (attempt < META_MAX_GRAPH_RETRIES - 1) {
        await sleep(backoffDelayMsFromHeaders({}, attempt));
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
  throw new Error('meta_paging_failed');
}

/**
 * Itera coleção Graph usando `data` + `paging.next`.
 * @param {string} accessToken
 * @param {string} relative e.g. `act_123/campaigns`
 * @param {Record<string,string|number|boolean>} params
 */
async function iterateAllEdges(accessToken, relative, params) {
  const cleaned = relative.replace(/^\//, '');
  let nextUrl = null;
  const collected = [];
  let page = 0;

  while (page < META_MAX_PAGES) {
    /** @type {object} */
    const payload =
      nextUrl === null
        ? await fbGet(accessToken, cleaned, params)
        : await axiosGetFullPagingUrl(accessToken, nextUrl);

    const chunk = Array.isArray(payload.data) ? payload.data : [];
    for (const row of chunk) collected.push(row);

    nextUrl = payload.paging && payload.paging.next ? String(payload.paging.next) : null;
    if (!nextUrl) break;
    page += 1;
  }

  return collected;
}

module.exports = {
  graphRoot,
  fbGet,
  iterateAllEdges,
};
