'use strict';

/**
 * Extrai copy/CTA/video conforme guia HOOKO (Meta AdCreative — object_story_spec vs asset_feed_spec).
 * @see SRC/documentacao/feature/metasync.md (secção criativos)
 */

function firstText(arr, key = 'text') {
  if (!Array.isArray(arr) || !arr.length) return null;
  const row = arr[0];
  if (!row || typeof row !== 'object') return null;
  const v = row[key];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

function firstNested(arr, outerKey) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const row = arr[0];
  if (!row || typeof row !== 'object') return null;
  const v = row[outerKey];
  return v != null && String(v).trim() ? String(v).trim() : null;
}

/**
 * `@returns {boolean}` True se há conteúdo dinâmico relevante em `asset_feed_spec`.
 */
function hasUsableAssetFeed(feed) {
  if (!feed || typeof feed !== 'object') return false;
  const keys = ['bodies', 'titles', 'videos', 'images', 'call_to_action_types', 'descriptions'];
  return keys.some((k) => Array.isArray(feed[k]) && feed[k].length > 0);
}

function pushVideoId(ids, raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || ids.includes(s)) return;
  ids.push(s);
}

/**
 * Todos os IDs de vídeo candidatos (ordem de prioridade para playback).
 * `object_story_spec.video_data` costuma ter o MP4; `creative.video_id` pode ser reel IG sem source.
 */
function extractVideoIdsFromCreative(creative) {
  const c = creative && typeof creative === 'object' ? creative : {};
  const ids = [];
  const spec = c.object_story_spec;

  if (spec && typeof spec === 'object') {
    pushVideoId(ids, spec.video_data?.video_id);
    pushVideoId(ids, spec.link_data?.video_id);
  }

  if (c.asset_feed_spec && hasUsableAssetFeed(c.asset_feed_spec)) {
    const videos = c.asset_feed_spec.videos;
    if (Array.isArray(videos)) {
      for (const row of videos) pushVideoId(ids, row?.video_id);
    }
  }

  pushVideoId(ids, c.video_id);
  return ids;
}

/**
 * Extrai vídeo quando presente nos vários layouts.
 */
function extractVideoIdFromCreative(creative) {
  const ids = extractVideoIdsFromCreative(creative);
  return ids[0] || null;
}

/**
 * Payload persistido em `ads.raw_creative_data` (auditável).
 */
function shrinkRawCreative(creative) {
  const c = creative && typeof creative === 'object' ? creative : {};
  return {
    id: c.id != null ? String(c.id) : null,
    name: c.name != null ? String(c.name) : null,
    object_type: c.object_type != null ? String(c.object_type) : null,
    body: c.body,
    title: c.title,
    call_to_action_type: c.call_to_action_type != null ? String(c.call_to_action_type) : null,
    video_id: c.video_id,
    thumbnail_url: c.thumbnail_url,
    image_url: c.image_url,
    link_url: c.link_url,
    instagram_permalink_url: c.instagram_permalink_url,
    effective_instagram_media_id: c.effective_instagram_media_id,
    object_story_spec: c.object_story_spec || null,
    asset_feed_spec: c.asset_feed_spec || null,
  };
}

/**
 * @param {object|null|undefined} creative — objeto AdCreative (Graph)
 * @returns {{
 *   metaCreativeId: string|null,
 *   primaryText: string|null,
 *   headline: string|null,
 *   ctaType: string|null,
 *   isDynamicCreative: boolean,
 *   videoId: string|null,
 *   rawCreativeData: object
 * }}
 */
function parseAdCreativeForStorage(creative) {
  const c = creative && typeof creative === 'object' ? creative : {};
  const metaCreativeId = c.id != null ? String(c.id) : null;

  /** Dynamic: texto em asset_feed_spec. */
  if (hasUsableAssetFeed(c.asset_feed_spec)) {
    const feed = c.asset_feed_spec;
    const primaryText = firstText(feed.bodies, 'text');
    const headline = firstText(feed.titles, 'text');
    const ctaType = firstNested(feed.call_to_action_types || [], 'call_to_action_type');
    let ctaFallback =
      c.call_to_action_type != null ? String(c.call_to_action_type) : null;
    let videoId = null;
    if (Array.isArray(feed.videos) && feed.videos.length) {
      const v0 = feed.videos[0];
      if (v0 && v0.video_id) videoId = String(v0.video_id);
    }
    videoId = videoId || extractVideoIdFromCreative(c);

    return {
      metaCreativeId,
      primaryText,
      headline,
      ctaType: ctaType || ctaFallback,
      isDynamicCreative: true,
      videoId,
      rawCreativeData: shrinkRawCreative(c),
    };
  }

  /** Static: object_story_spec (vídeo ou link); fallback campos raiz. */
  const spec = c.object_story_spec && typeof c.object_story_spec === 'object' ? c.object_story_spec : {};

  let primaryText = null;
  let headline = null;
  let ctaType = null;

  if (spec.video_data && typeof spec.video_data === 'object') {
    const d = spec.video_data;
    primaryText = d.message != null ? String(d.message).trim() || null : null;
    headline = d.title != null ? String(d.title).trim() || null : null;
    if (d.call_to_action && typeof d.call_to_action === 'object')
      ctaType = d.call_to_action.type != null ? String(d.call_to_action.type) : null;
  } else if (spec.link_data && typeof spec.link_data === 'object') {
    const d = spec.link_data;
    primaryText = d.message != null ? String(d.message).trim() || null : null;
    headline = d.name != null ? String(d.name).trim() || null : null;
    if (d.call_to_action && typeof d.call_to_action === 'object')
      ctaType = d.call_to_action.type != null ? String(d.call_to_action.type) : null;
  }

  if (primaryText == null && c.body != null) primaryText = String(c.body).trim() || null;
  if (headline == null && c.title != null) headline = String(c.title).trim() || null;
  if (ctaType == null && c.call_to_action_type != null)
    ctaType = String(c.call_to_action_type);

  const videoId = extractVideoIdFromCreative(c);

  return {
    metaCreativeId,
    primaryText,
    headline,
    ctaType,
    isDynamicCreative: false,
    videoId,
    rawCreativeData: shrinkRawCreative(c),
  };
}

module.exports = {
  parseAdCreativeForStorage,
  extractVideoIdFromCreative,
  extractVideoIdsFromCreative,
  hasUsableAssetFeed,
};
