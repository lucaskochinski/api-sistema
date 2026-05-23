'use strict';

const axios = require('axios');
const metaVideoPlayback = require('./meta_video_playback.service');

const DOWNLOAD_TIMEOUT_MS = Number(process.env.META_VIDEO_DOWNLOAD_TIMEOUT_MS || 600000);

async function downloadVideoFromUrl(sourceUrl) {
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
  const mimeType = bin.headers['content-type']
    ? String(bin.headers['content-type']).split(';')[0]
    : 'video/mp4';

  return { buffer, mimeType };
}

/**
 * Baixa MP4 usando a mesma resolução de URL da página do anúncio
 * (`fetchMetaVideoPlayback`: video node → advideos → creative expandido).
 *
 * @param {string} organizationId
 * @param {string} metaVideoId
 * @param {{ metaAdGraphId?: string|null, rawCreative?: object|null }} [options]
 */
async function fetchVideoMp4ViaGraph(organizationId, metaVideoId, options = {}) {
  const playback = await metaVideoPlayback.fetchMetaVideoPlayback(organizationId, {
    metaVideoId,
    metaAdGraphId: options.metaAdGraphId || null,
    rawCreative: options.rawCreative || null,
  });

  if (!playback?.url || playback.type !== 'video') {
    const reason =
      playback?.reason || 'meta_video_source_url_missing_permissions_or_processing';
    const err = new Error(reason);
    err.statusCode = playback?.unavailable ? 422 : 502;
    err.playback = playback;
    throw err;
  }

  const { buffer, mimeType } = await downloadVideoFromUrl(playback.url);

  return {
    buffer,
    mimeType,
    metaVideoDurationSeconds: options.metaVideoDurationSeconds ?? null,
    playbackStrategy: playback.strategy || null,
    resolvedVideoId: playback.videoId || metaVideoId,
  };
}

module.exports = {
  fetchVideoMp4ViaGraph,
  downloadVideoFromUrl,
};
