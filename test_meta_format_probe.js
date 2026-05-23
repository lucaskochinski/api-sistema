'use strict';

/**
 * Probe: o que a Meta Graph API realmente devolve sobre formatos/dimensões.
 *
 * Uso (NUNCA commitar o token):
 *   META_ACCESS_TOKEN=EAA... META_ACT_ID=2496055307427709 node test_meta_format_probe.js
 */

process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');

const CREATIVE_FIELDS = [
  'id',
  'name',
  'object_type',
  'body',
  'title',
  'call_to_action_type',
  'thumbnail_url',
  'image_url',
  'video_id',
  'object_story_spec',
  'asset_feed_spec',
  'effective_object_story_id',
].join(',');

const VIDEO_FIELDS = [
  'id',
  'length',
  'format',
  'source',
  'picture',
  'thumbnails',
].join(',');

function pickKeys(obj, maxDepth = 2, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 2).map((x) => pickKeys(x, maxDepth, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'source' && typeof v === 'string') {
      out[k] = `[url ${v.length} chars]`;
    } else if (typeof v === 'string' && v.length > 120) {
      out[k] = `[string ${v.length} chars]`;
    } else {
      out[k] = pickKeys(v, maxDepth, depth + 1);
    }
  }
  return out;
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  const actRaw = process.env.META_ACT_ID || '2496055307427709';
  const actId = String(actRaw).startsWith('act_') ? actRaw : `act_${actRaw}`;

  if (!token) {
    console.error('Defina META_ACCESS_TOKEN no ambiente.');
    process.exit(1);
  }

  console.log('=== META FORMAT PROBE ===');
  console.log('act:', actId);
  console.log('graph version:', process.env.META_GRAPH_API_VERSION);

  const campaigns = await graph.iterateAllEdges(token, `${actId}/campaigns`, {
    fields: 'id,name,status',
    limit: 15,
  });
  console.log('\nCampanhas encontradas:', campaigns.length);

  /** @type {object[]} */
  const samples = [];

  for (const camp of campaigns) {
    if (samples.length >= 5) break;

    const ads = await graph.iterateAllEdges(token, `${camp.id}/ads`, {
      fields: `id,name,status,creative{${CREATIVE_FIELDS}}`,
      limit: 8,
    }).catch(() => []);

    for (const ad of ads) {
      if (samples.length >= 5) break;
      const creative = ad.creative || {};
      /** @type {object} */
      const row = {
        campaignId: camp.id,
        campaignName: camp.name,
        adId: ad.id,
        adName: ad.name,
        creative: pickKeys(creative, 3),
        videoNode: null,
        videoFieldsPresent: [],
        creativeFieldsPresent: Object.keys(creative),
      };

      const videoId =
        creative.video_id ||
        creative.object_story_spec?.video_data?.video_id ||
        creative.asset_feed_spec?.videos?.[0]?.video_id ||
        null;

      if (videoId) {
        const vhead = await graph.fbGet(token, String(videoId), { fields: VIDEO_FIELDS });
        row.videoNode = pickKeys(vhead, 3);
        row.videoFieldsPresent = Object.keys(vhead || {});
        if (vhead?.error) row.videoError = vhead.error;
      }

      samples.push(row);
    }
  }

  console.log('\n=== AMOSTRAS (até 5 ads) ===');
  console.log(JSON.stringify(samples, null, 2));

  const summary = {
    adsSampled: samples.length,
    withVideoId: samples.filter((s) => s.videoNode).length,
    videoHasWidthHeight: samples.filter(
      (s) => s.videoNode && s.videoNode.width && s.videoNode.height,
    ).length,
    videoHasFormatArray: samples.filter(
      (s) => s.videoNode && Array.isArray(s.videoNode.format) && s.videoNode.format.length,
    ).length,
    creativeHasObjectStorySpec: samples.filter((s) => s.creative?.object_story_spec).length,
    creativeHasAssetFeedSpec: samples.filter((s) => s.creative?.asset_feed_spec).length,
    creativeHasObjectType: samples.filter((s) => s.creative?.object_type).length,
  };

  console.log('\n=== RESUMO CAMPOS REAIS ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Falha:', err.response?.data || err.message || err);
  process.exit(1);
});
