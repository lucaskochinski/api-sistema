'use strict';

const graph = require('./meta_graph.client');
const metaService = require('../Features/Meta/meta.service');
const metaCreativeParser = require('../Features/MetaSync/meta_ad_creative_parser');
const metaThumbnail = require('./meta_thumbnail.service');

const AD_CREATIVE_VIDEO_FIELDS =
  'creative{id,video_id,object_type,thumbnail_url,image_url,instagram_permalink_url,object_story_spec{video_data{video_id,image_url}},asset_feed_spec{videos{video_id}}}';

function graphPayloadHasError(payload) {
  return Boolean(payload && typeof payload === 'object' && payload.error);
}

function extractVideoIdsFromCreative(creative) {
  return metaCreativeParser.extractVideoIdsFromCreative(creative);
}

function extractVideoIdFromCreative(creative) {
  const ids = extractVideoIdsFromCreative(creative);
  return ids[0] || null;
}

function extractVideoIdFromRawCreative(rawCreative) {
  if (!rawCreative || typeof rawCreative !== 'object') return null;
  return extractVideoIdFromCreative(rawCreative);
}

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const s = id != null ? String(id).trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function fetchVideoSourceById(accessToken, videoId) {
  if (!videoId) return null;

  const vhead = await graph.fbGet(accessToken, String(videoId), {
    fields: 'id,source,picture,permalink_url,embed_html,format,thumbnails',
  });
  if (graphPayloadHasError(vhead)) return null;

  const hdThumb = metaThumbnail.resolveVideoNodeThumbnail(vhead);

  if (vhead?.source) {
    return {
      type: 'video',
      url: vhead.source,
      thumbnailUrl: hdThumb,
      videoId: String(videoId),
      strategy: 'video_node_source',
    };
  }

  return null;
}

async function fetchFromAdAccountVideos(accessToken, metaAdGraphId, videoId) {
  if (!metaAdGraphId || !videoId) return null;

  const adHead = await graph.fbGet(accessToken, String(metaAdGraphId), {
    fields: 'account_id',
  });
  if (graphPayloadHasError(adHead) || !adHead?.account_id) return null;

  const actRaw = String(adHead.account_id);
  const actId = actRaw.startsWith('act_') ? actRaw : `act_${actRaw}`;

  let rows = [];
  try {
    rows = await graph.iterateAllEdges(accessToken, `${actId}/advideos`, {
      fields: 'id,source,picture,permalink_url,title',
      filtering: JSON.stringify([{ field: 'id', operator: 'EQUAL', value: String(videoId) }]),
      limit: 5,
    });
  } catch (_) {
    rows = [];
  }

  const match = rows.find((r) => String(r.id) === String(videoId)) || rows[0];
  if (match?.source) {
    return {
      type: 'video',
      url: match.source,
      thumbnailUrl: match.picture ? String(match.picture) : null,
      videoId: String(match.id || videoId),
      strategy: 'act_advideos',
    };
  }

  return null;
}

async function fetchMetaVideoPlayback(organizationId, { metaVideoId, metaAdGraphId, rawCreative } = {}) {
  const { accessToken } = await metaService.getValidToken(organizationId);

  const candidateIds = uniqueIds([
    metaVideoId,
    ...extractVideoIdsFromCreative(rawCreative),
  ]);

  for (const vid of candidateIds) {
    const fromNode = await fetchVideoSourceById(accessToken, vid);
    if (fromNode) return fromNode;

    const fromAct = await fetchFromAdAccountVideos(accessToken, metaAdGraphId, vid);
    if (fromAct) return fromAct;
  }

  let creative = rawCreative && typeof rawCreative === 'object' ? rawCreative : null;
  let instagramPermalink = creative?.instagram_permalink_url || null;

  if (metaAdGraphId) {
    const adData = await graph.fbGet(accessToken, String(metaAdGraphId), {
      fields: AD_CREATIVE_VIDEO_FIELDS,
    });
    if (!graphPayloadHasError(adData)) {
      creative = adData.creative || creative;
      instagramPermalink =
        creative?.instagram_permalink_url || instagramPermalink || null;

      for (const creativeVideoId of extractVideoIdsFromCreative(creative)) {
        if (candidateIds.includes(creativeVideoId)) continue;
        candidateIds.push(creativeVideoId);

        const fromNode = await fetchVideoSourceById(accessToken, creativeVideoId);
        if (fromNode) return fromNode;

        const fromAct = await fetchFromAdAccountVideos(accessToken, metaAdGraphId, creativeVideoId);
        if (fromAct) return fromAct;
      }

      const thumbnailUrl = metaThumbnail.pickThumbnailFromCreative(creative);
      const isVideoCreative =
        String(creative?.object_type || '').toUpperCase() === 'VIDEO' ||
        Boolean(creativeVideoId) ||
        Boolean(metaVideoId);

      if (!isVideoCreative && (creative?.image_url || thumbnailUrl)) {
        return {
          type: 'image',
          url: creative.image_url || thumbnailUrl,
          thumbnailUrl,
          strategy: 'creative_image',
        };
      }
    }
  }

  const thumb = metaThumbnail.pickThumbnailFromCreative(creative || rawCreative);

  if (instagramPermalink) {
    return {
      type: 'embed',
      url: null,
      embedUrl: instagramPermalink,
      thumbnailUrl: thumb,
      unavailable: true,
      reason: 'video_source_instagram_only',
      strategy: 'instagram_permalink',
    };
  }

  return {
    type: 'video',
    url: null,
    thumbnailUrl: thumb,
    unavailable: true,
    reason: 'meta_video_source_unavailable',
    strategy: 'none',
  };
}

module.exports = {
  fetchMetaVideoPlayback,
  extractVideoIdFromRawCreative,
  extractVideoIdFromCreative,
  extractVideoIdsFromCreative,
};
