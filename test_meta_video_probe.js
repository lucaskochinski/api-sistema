'use strict';

/**
 * Probe local: como obter URL de vídeo Meta para um ad/video específico.
 *
 * Uso:
 *   META_SYSTEM_ACCESS_TOKEN=EAA... node test_meta_video_probe.js
 *   META_ORG_ACCESS_TOKEN=EAA... node test_meta_video_probe.js
 *   node test_meta_video_probe.js EAA...   # token como 1º arg
 */

process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');

const META_AD_ID = process.env.PROBE_META_AD_ID || '120249726853890230';
const META_VIDEO_ID = process.env.PROBE_META_VIDEO_ID || '1327925122737513';

const CREATIVE_FIELDS = [
  'id',
  'video_id',
  'object_type',
  'thumbnail_url',
  'image_url',
  'effective_object_story_id',
  'object_story_id',
  'instagram_permalink_url',
  'object_story_spec{video_data{video_id,image_url},link_data{picture}}',
  'asset_feed_spec{videos{video_id}}',
].join(',');

async function tryCall(label, token, path, params) {
  process.stdout.write(`\n--- ${label} ---\n`);
  try {
    const data = await graph.fbGet(token, path, params);
    if (data?.error) {
      console.log('ERROR:', JSON.stringify(data.error, null, 2));
      return { ok: false, data };
    }
    const preview = JSON.stringify(data, null, 2);
    console.log(preview.length > 4000 ? `${preview.slice(0, 4000)}\n... [truncated]` : preview);
    const source =
      data?.source ||
      data?.creative?.video_id ||
      data?.data?.[0]?.source ||
      null;
    if (source) console.log('✅ source/url encontrado:', String(source).slice(0, 120));
    return { ok: true, data };
  } catch (err) {
    console.log('THROW:', err.message);
    if (err.metaFb) console.log(JSON.stringify(err.metaFb, null, 2));
    return { ok: false, error: err.message };
  }
}

async function runWithToken(label, token) {
  console.log('\n' + '='.repeat(60));
  console.log(`TOKEN: ${label} (${String(token).slice(0, 20)}...)`);
  console.log('='.repeat(60));

  await tryCall('Video node: source,picture,format,permalink_url', token, META_VIDEO_ID, {
    fields: 'id,source,picture,format,permalink_url,embed_html,title,length',
  });

  await tryCall('Video node: source only', token, META_VIDEO_ID, { fields: 'source' });

  await tryCall('Ad + creative expandido', token, META_AD_ID, {
    fields: `creative{${CREATIVE_FIELDS}}`,
  });

  await tryCall('Ad + account_id (para advideos)', token, META_AD_ID, {
    fields: 'account_id,creative{video_id,object_type}',
  });

  const adHead = await graph.fbGet(token, META_AD_ID, { fields: 'account_id' }).catch(() => ({}));
  const actId = adHead?.account_id ? String(adHead.account_id) : null;
  if (actId) {
    await tryCall(`AdAccount advideos filter id=${META_VIDEO_ID}`, token, `${actId}/advideos`, {
      fields: 'id,source,title,permalink_url',
      filtering: JSON.stringify([{ field: 'id', operator: 'EQUAL', value: META_VIDEO_ID }]),
      limit: 5,
    });

    await tryCall('AdAccount advideos (recentes)', token, `${actId}/advideos`, {
      fields: 'id,source,title',
      limit: 3,
    });
  }

  await tryCall('Ad insights (date_preset last_30d)', token, `${META_AD_ID}/insights`, {
    fields: 'impressions,spend,clicks',
    date_preset: 'last_30d',
  });

  await tryCall('Ad insights breakdown placement', token, `${META_AD_ID}/insights`, {
    fields: 'impressions,spend,clicks',
    breakdowns: 'publisher_platform,platform_position',
    date_preset: 'last_30d',
  });
}

async function main() {
  const argToken = process.argv[2];
  const systemToken = argToken || process.env.META_SYSTEM_ACCESS_TOKEN || null;
  const orgToken = process.env.META_ORG_ACCESS_TOKEN || null;

  if (!systemToken && !orgToken) {
    console.error('Forneça token: META_SYSTEM_ACCESS_TOKEN, META_ORG_ACCESS_TOKEN ou argv[2]');
    process.exit(1);
  }

  console.log('Probe Meta Video');
  console.log('  ad_id   :', META_AD_ID);
  console.log('  video_id:', META_VIDEO_ID);

  if (systemToken) await runWithToken('SYSTEM', systemToken);
  if (orgToken && orgToken !== systemToken) await runWithToken('ORG', orgToken);

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
