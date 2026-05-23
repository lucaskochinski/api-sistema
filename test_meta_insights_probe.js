'use strict';

/**
 * Probe insights + vídeo para um ad/conta Meta.
 * META_ACCESS_TOKEN=EAA... META_ACT_ID=2496055307427709 node test_meta_insights_probe.js
 */

process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');
const { INSIGHT_FIELDS } = require('./SRC/Services/meta_insights_metrics.service');

const TOKEN = process.argv[2] || process.env.META_ACCESS_TOKEN || process.env.META_SYSTEM_ACCESS_TOKEN;
const ACT_ID = process.env.META_ACT_ID || '2496055307427709';
const AD_ID = process.env.PROBE_META_AD_ID || '120249726853890230';

async function section(title, fn) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
  try {
    await fn();
  } catch (e) {
    console.log('ERRO:', e.message);
    if (e.metaFb) console.log(JSON.stringify(e.metaFb, null, 2));
  }
}

async function main() {
  if (!TOKEN) {
    console.error('Passe META_ACCESS_TOKEN ou token como argv[2]');
    process.exit(1);
  }

  const act = ACT_ID.startsWith('act_') ? ACT_ID : `act_${ACT_ID}`;
  console.log('act:', act, '| ad:', AD_ID);

  await section('1) Conta', async () => {
    const acc = await graph.fbGet(TOKEN, act, { fields: 'id,name,account_status,currency' });
    console.log(JSON.stringify(acc, null, 2));
  });

  await section('2) Campanhas (5)', async () => {
    const camps = await graph.iterateAllEdges(TOKEN, `${act}/campaigns`, {
      fields: 'id,name,status',
      limit: 5,
    });
    console.log(JSON.stringify(camps, null, 2));
  });

  await section('3) Ads da 1ª campanha com spend', async () => {
    const camps = await graph.iterateAllEdges(TOKEN, `${act}/campaigns`, {
      fields: 'id,name',
      limit: 10,
    });
    for (const c of camps) {
      const ads = await graph.iterateAllEdges(TOKEN, `${c.id}/ads`, {
        fields: 'id,name,status,creative{video_id,object_type,thumbnail_url}',
        limit: 5,
      });
      if (!ads.length) continue;
      console.log('Campanha:', c.name, c.id);
      console.log(JSON.stringify(ads, null, 2));
      break;
    }
  });

  await section(`4) Insights ad ${AD_ID} (date_preset last_30d, campos mínimos)`, async () => {
    const rows = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
      fields: 'impressions,reach,clicks,spend,ctr,date_start,date_stop',
      date_preset: 'last_30d',
      limit: 50,
    });
    console.log('rows:', rows.length);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  });

  await section(`5) Insights ad ${AD_ID} (time_increment=1, last 30d)`, async () => {
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const rows = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
      fields: 'impressions,clicks,spend,ctr,date_start',
      time_increment: 1,
      time_range: JSON.stringify({ since, until }),
      limit: 50,
    });
    console.log('rows:', rows.length);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  });

  await section(`6) Insights ad ${AD_ID} (INSIGHT_FIELDS sync)`, async () => {
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    try {
      const rows = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
        fields: INSIGHT_FIELDS,
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        limit: 10,
      });
      console.log('rows:', rows.length);
      console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    } catch (e) {
      console.log('Falhou INSIGHT_FIELDS completo:', e.message);
    }
  });

  await section('7) Breakdown publisher_platform,platform_position', async () => {
    const rows = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
      fields: 'impressions,clicks,spend',
      breakdowns: 'publisher_platform,platform_position',
      date_preset: 'last_30d',
      limit: 20,
    });
    console.log('rows:', rows.length);
    console.log(JSON.stringify(rows, null, 2));
  });

  await section('8) Vídeo source', async () => {
    const ad = await graph.fbGet(TOKEN, AD_ID, {
      fields: 'creative{video_id,object_type,instagram_permalink_url,object_story_spec{video_data{video_id}}}',
    });
    const vid =
      ad?.creative?.video_id ||
      ad?.creative?.object_story_spec?.video_data?.video_id ||
      null;
    console.log('creative:', JSON.stringify(ad?.creative || {}, null, 2));
    if (vid) {
      const v = await graph.fbGet(TOKEN, String(vid), { fields: 'source,picture,permalink_url' });
      console.log('video node:', JSON.stringify(v, null, 2));
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
