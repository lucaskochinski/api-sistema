'use strict';

/** Cache local de URLs de playback Meta (ingest_metadata) — evita Graph a cada page view. */

const DEFAULT_TTL_MS = Number(process.env.META_PLAYBACK_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

function parseTs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function isFresh(expiresAt) {
  const exp = parseTs(expiresAt);
  if (!exp) return true;
  return exp > Date.now();
}

/**
 * @param {Record<string, unknown> | null | undefined} ingestMeta
 */
function readCachedPlayback(ingestMeta) {
  const meta = ingestMeta && typeof ingestMeta === 'object' ? ingestMeta : {};
  const url = meta.playbackUrl || meta.playback_url;
  if (!url || typeof url !== 'string' || !url.trim()) return null;

  const expiresAt = meta.playbackUrlExpiresAt || meta.playback_url_expires_at;
  if (!isFresh(expiresAt)) return null;

  return {
    type: meta.playbackType || meta.playback_type || 'video',
    url: String(url).trim(),
    thumbnailUrl: meta.thumbnailUrl || meta.thumbnail_url || null,
    embedUrl: meta.playbackEmbedUrl || meta.playback_embed_url || null,
    strategy: 'db_playback_cache',
    cached: true,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} existingMeta
 * @param {{ type?: string, url?: string|null, thumbnailUrl?: string|null, embedUrl?: string|null, strategy?: string }} playback
 * @param {{ ttlMs?: number }} [opts]
 */
function writePlaybackCache(existingMeta, playback, opts = {}) {
  const base = existingMeta && typeof existingMeta === 'object' ? { ...existingMeta } : {};
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const now = new Date();

  if (playback?.url && playback.type === 'video') {
    base.playbackUrl = playback.url;
    base.playbackType = 'video';
    base.playbackUrlCachedAt = now.toISOString();
    base.playbackUrlExpiresAt = new Date(now.getTime() + ttlMs).toISOString();
    base.lastPlaybackStrategy = playback.strategy || base.lastPlaybackStrategy || null;
  }

  if (playback?.embedUrl) {
    base.playbackEmbedUrl = playback.embedUrl;
  }

  if (playback?.thumbnailUrl) {
    base.thumbnailUrl = playback.thumbnailUrl;
  }

  base.lastRefreshedAt = now.toISOString();
  return base;
}

/**
 * Resolve playback só com dados já persistidos (sem Graph API).
 */
function resolveFromStorage({ ingestMeta, rawCreative, isVideoAd, thumbnailUrl }) {
  const cached = readCachedPlayback(ingestMeta);
  if (cached?.url) return cached;

  const creative =
    rawCreative && typeof rawCreative === 'object' ? rawCreative : {};
  const ig = creative.instagram_permalink_url || null;
  if (ig) {
    return {
      type: 'embed',
      url: null,
      embedUrl: ig,
      thumbnailUrl: ingestMeta?.thumbnailUrl || thumbnailUrl || null,
      strategy: 'raw_creative_embed',
      cached: true,
    };
  }

  const thumb =
    ingestMeta?.thumbnailUrl ||
    thumbnailUrl ||
    creative.thumbnail_url ||
    creative.image_url ||
    null;

  if (!isVideoAd && thumb) {
    return {
      type: 'image',
      url: thumb,
      thumbnailUrl: thumb,
      strategy: 'raw_creative_image',
      cached: true,
    };
  }

  return null;
}

function buildOfflineStub({ ingestMeta, rawCreative, isVideoAd, thumbnailUrl }) {
  const fromStorage = resolveFromStorage({ ingestMeta, rawCreative, isVideoAd, thumbnailUrl });
  if (fromStorage) return fromStorage;

  const thumb =
    ingestMeta?.thumbnailUrl ||
    thumbnailUrl ||
    (rawCreative && typeof rawCreative === 'object'
      ? rawCreative.thumbnail_url || rawCreative.image_url
      : null) ||
    null;

  return {
    type: isVideoAd ? 'video' : 'image',
    url: null,
    thumbnailUrl: thumb,
    unavailable: true,
    reason: 'playback_cache_miss',
    strategy: 'db_offline',
    cached: false,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  readCachedPlayback,
  writePlaybackCache,
  resolveFromStorage,
  buildOfflineStub,
};
