'use strict';

const axios = require('axios');
const metaService = require('../Features/Meta/meta.service');

const DOWNLOAD_TIMEOUT_MS = Number(process.env.META_VIDEO_DOWNLOAD_TIMEOUT_MS || 600000);

async function fetchVideoMp4ViaGraph(organizationId, metaVideoId) {
  const { accessToken } = await metaService.getValidToken(organizationId);

  const v = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const vn = String(v).startsWith('v') ? v : `v${v}`;
  const metaUrl = `https://graph.facebook.com/${vn}/${encodeURIComponent(String(metaVideoId))}`;

  const { data: meta } = await axios.get(metaUrl, {
    params: { fields: 'source,length', access_token: accessToken },
    timeout: Number(process.env.META_GRAPH_TIMEOUT_MS || 60000),
    validateStatus: () => true,
  });

  if (meta && meta.error) {
    const err = new Error(meta.error.message || 'meta_video_lookup_failed');
    err.statusCode = 502;
    err.metaFb = meta.error;
    throw err;
  }

  const sourceUrl = meta && typeof meta.source === 'string' ? meta.source.trim() : '';
  if (!sourceUrl) {
    const err = new Error('meta_video_source_url_missing_permissions_or_processing');
    err.statusCode = 422;
    throw err;
  }

  /** URL assinado temporário pela Meta normalmente já expõe o binário público autorizado pela query */
  const bin = await axios.get(sourceUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (bin.status < 200 || bin.status >= 300) {
    const err = new Error(`meta_video_binary_http_${bin.status}`);
    err.statusCode = 502;
    throw err;
  }

  const buffer = Buffer.isBuffer(bin.data) ? bin.data : Buffer.from(bin.data);
  /** Content-Type opcional pela CDN */
  const mimeType = bin.headers['content-type']
    ? String(bin.headers['content-type']).split(';')[0]
    : 'video/mp4';

  let metaVideoDurationSeconds = null;
  if (meta && meta.length != null) {
    const L = Number(meta.length);
    if (Number.isFinite(L) && L > 0) metaVideoDurationSeconds = L;
  }

  return { buffer, mimeType, metaVideoDurationSeconds };
}

module.exports = {
  fetchVideoMp4ViaGraph,
};
