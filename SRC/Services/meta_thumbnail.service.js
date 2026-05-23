'use strict';

function uniqueStringUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const s = u != null ? String(u).trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseDimensionsFromUrl(url) {
  const s = String(url || '');
  const match =
    s.match(/[?&]width=(\d+).*?[?&]height=(\d+)/i) ||
    s.match(/p(\d+)x(\d+)/i) ||
    s.match(/(\d{2,4})x(\d{2,4})/i);
  if (!match) return null;
  const w = Number.parseInt(match[1], 10);
  const h = Number.parseInt(match[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h, area: w * h };
}

function looksLikeLowResMetaThumb(url) {
  if (!url) return true;
  const dims = parseDimensionsFromUrl(url);
  if (dims && dims.area <= 120 * 120) return true;
  const s = String(url);
  if (/p(64|96|120)x(64|96|120)/i.test(s)) return true;
  if (/s64x64/i.test(s)) return true;
  if (/[_-]s\./i.test(s)) return true;
  return false;
}

function pickBestFromVideoThumbnailsPayload(thumbnailsPayload) {
  const data = thumbnailsPayload?.data;
  if (!Array.isArray(data) || !data.length) return null;

  let bestUri = null;
  let bestScore = -1;

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const uri = item.uri ? String(item.uri).trim() : '';
    if (!uri) continue;

    const w = Number(item.width) || 0;
    const h = Number(item.height) || 0;
    const area = w > 0 && h > 0 ? w * h : parseDimensionsFromUrl(uri)?.area || 1;
    const score = area + (item.is_preferred ? 1_000_000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestUri = uri;
    }
  }

  return bestUri;
}

function collectCreativeThumbnailCandidates(creative) {
  const c = creative && typeof creative === 'object' ? creative : {};
  const urls = [];

  if (c.image_url) urls.push(String(c.image_url));

  const spec = c.object_story_spec;
  if (spec && typeof spec === 'object') {
    if (spec.video_data?.image_url) urls.push(String(spec.video_data.image_url));
    if (spec.link_data?.picture) urls.push(String(spec.link_data.picture));
    if (spec.link_data?.image_url) urls.push(String(spec.link_data.image_url));
  }

  const afs = c.asset_feed_spec;
  if (afs && typeof afs === 'object') {
    if (Array.isArray(afs.images)) {
      for (const img of afs.images) {
        if (img?.url) urls.push(String(img.url));
      }
    }
    if (Array.isArray(afs.videos)) {
      for (const video of afs.videos) {
        if (video?.thumbnail_url) urls.push(String(video.thumbnail_url));
      }
    }
  }

  if (c.thumbnail_url) urls.push(String(c.thumbnail_url));

  return uniqueStringUrls(urls);
}

function pickBestUrlByResolution(urls) {
  const list = uniqueStringUrls(urls);
  if (!list.length) return null;

  let best = list[0];
  let bestArea = parseDimensionsFromUrl(best)?.area || 0;

  for (const url of list.slice(1)) {
    const area = parseDimensionsFromUrl(url)?.area || 0;
    if (area > bestArea) {
      best = url;
      bestArea = area;
      continue;
    }
    if (
      bestArea === 0 &&
      looksLikeLowResMetaThumb(best) &&
      !looksLikeLowResMetaThumb(url)
    ) {
      best = url;
    }
  }

  if (looksLikeLowResMetaThumb(best)) {
    const clearer = list.find((url) => !looksLikeLowResMetaThumb(url));
    if (clearer) return clearer;
  }

  return best;
}

function pickThumbnailFromCreative(creative) {
  return pickBestUrlByResolution(collectCreativeThumbnailCandidates(creative));
}

function resolveVideoNodeThumbnail(videoNode) {
  if (!videoNode || typeof videoNode !== 'object') return null;
  const fromThumbs = pickBestFromVideoThumbnailsPayload(videoNode.thumbnails);
  if (fromThumbs) return fromThumbs;
  if (videoNode.picture) return String(videoNode.picture);
  return null;
}

function extractVideoIdFromCreative(creative) {
  const c = creative && typeof creative === 'object' ? creative : {};
  return (
    c.video_id ||
    c.object_story_spec?.video_data?.video_id ||
    c.asset_feed_spec?.videos?.[0]?.video_id ||
    null
  );
}

async function fetchVideoThumbnailUrl(accessToken, videoId, graphClient) {
  if (!accessToken || !videoId || !graphClient) return null;

  try {
    const videoNode = await graphClient.fbGet(accessToken, String(videoId), {
      fields: 'id,picture,thumbnails',
    });
    if (videoNode?.error) return null;
    return resolveVideoNodeThumbnail(videoNode);
  } catch (_) {
    return null;
  }
}

async function resolveMetaThumbnailUrl(accessToken, { creative, videoId, graphClient }) {
  const fromCreative = pickThumbnailFromCreative(creative);
  const resolvedVideoId = videoId || extractVideoIdFromCreative(creative);

  if (!resolvedVideoId || !accessToken || !graphClient) {
    return fromCreative;
  }

  const shouldFetchVideoThumb =
    !fromCreative || looksLikeLowResMetaThumb(fromCreative) || Boolean(resolvedVideoId);

  if (!shouldFetchVideoThumb) {
    return fromCreative;
  }

  const fromVideo = await fetchVideoThumbnailUrl(
    accessToken,
    resolvedVideoId,
    graphClient,
  );
  if (!fromVideo) return fromCreative;
  if (!fromCreative) return fromVideo;

  return pickBestUrlByResolution([fromCreative, fromVideo]);
}

function shouldUpgradeStoredThumbnail(currentUrl, candidateUrl) {
  if (!candidateUrl) return false;
  if (!currentUrl) return true;

  const currentArea = parseDimensionsFromUrl(currentUrl)?.area || 0;
  const candidateArea = parseDimensionsFromUrl(candidateUrl)?.area || 0;
  if (candidateArea > currentArea) return true;

  if (looksLikeLowResMetaThumb(currentUrl) && !looksLikeLowResMetaThumb(candidateUrl)) {
    return true;
  }

  return false;
}

module.exports = {
  pickThumbnailFromCreative,
  pickBestUrlByResolution,
  pickBestFromVideoThumbnailsPayload,
  resolveVideoNodeThumbnail,
  fetchVideoThumbnailUrl,
  resolveMetaThumbnailUrl,
  looksLikeLowResMetaThumb,
  shouldUpgradeStoredThumbnail,
  collectCreativeThumbnailCandidates,
  extractVideoIdFromCreative,
};
