'use strict';

/**
 * Varre anúncios da conta e testa insights + vídeo + breakdown.
 * META_ACCESS_TOKEN=EAA... META_ACT_ID=2496055307427709 node test_meta_ads_batch_probe.js
 */

process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');
const { INSIGHT_FIELDS } = require('./SRC/Services/meta_insights_metrics.service');

const TOKEN = process.argv[2] || process.env.META_ACCESS_TOKEN || process.env.META_SYSTEM_ACCESS_TOKEN;
const ACT_ID = process.env.META_ACT_ID || '2496055307427709';

function actPrefix(id) {
  const s = String(id).trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function adInsights(token, metaAdId, { daily = false } = {}) {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const params = daily
    ? {
        fields: 'impressions,spend,clicks,ctr,date_start,date_stop',
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        limit: 35,
      }
    : {
        fields: 'impressions,spend,clicks,ctr,date_start,date_stop',
        date_preset: 'last_30d',
        limit: 5,
      };

  return graph.iterateAllEdges(token, `${metaAdId}/insights`, params);
}

async function adBreakdown(token, metaAdId) {
  return graph.iterateAllEdges(token, `${metaAdId}/insights`, {
    fields: 'impressions,spend,clicks',
    breakdowns: 'publisher_platform,platform_position',
    date_preset: 'last_30d',
    limit: 20,
  });
}

async function adVideo(token, metaAdId) {
  const ad = await graph.fbGet(token, metaAdId, {
    fields:
      'name,creative{video_id,object_type,thumbnail_url,instagram_permalink_url,object_story_spec{video_data{video_id}}}',
  });
  if (ad?.error) return { error: ad.error.message };

  const c = ad.creative || {};
  const videoId = c.video_id || c.object_story_spec?.video_data?.video_id || null;
  let source = null;
  if (videoId) {
    const v = await graph.fbGet(token, String(videoId), { fields: 'source,picture' });
    source = v?.source || null;
  }

  return {
    adName: ad.name,
    objectType: c.object_type,
    videoId,
    hasMp4Source: Boolean(source),
    instagramUrl: c.instagram_permalink_url || null,
  };
}

async function main() {
  if (!TOKEN) {
    console.error('Passe META_ACCESS_TOKEN ou token como argv[2]');
    process.exit(1);
  }

  const act = actPrefix(ACT_ID);
  console.log('Conta:', act);

  // Top ads by spend via account insights
  const topAds = await graph.iterateAllEdges(TOKEN, `${act}/insights`, {
    fields: 'ad_id,ad_name,impressions,spend,clicks',
    level: 'ad',
    date_preset: 'last_30d',
    sort: 'spend_descending',
    limit: 8,
  });

  console.log('\n=== TOP 8 ANÚNCIOS POR GASTO (act/insights level=ad) ===');
  for (const row of topAds) {
    console.log(
      `- ${row.ad_name} (${row.ad_id}) | spend=${row.spend} imp=${row.impressions} clicks=${row.clicks}`,
    );
  }

  const testIds = [
    ...(process.env.PROBE_AD_IDS || '').split(',').filter(Boolean),
    ...topAds.slice(0, 5).map((r) => String(r.ad_id)),
    '120249726853890230', // cabritado
  ];

  const unique = [...new Set(testIds)];

  console.log('\n=== DETALHE POR ANÚNCIO ===');
  for (const metaAdId of unique) {
    console.log('\n---', metaAdId, '---');
    try {
      const [agg, daily, breakdown, video] = await Promise.all([
        adInsights(TOKEN, metaAdId, { daily: false }),
        adInsights(TOKEN, metaAdId, { daily: true }),
        adBreakdown(TOKEN, metaAdId).catch((e) => ({ error: e.message })),
        adVideo(TOKEN, metaAdId).catch((e) => ({ error: e.message })),
      ]);

      console.log('insights agg rows:', agg.length, agg[0] || '(vazio)');
      console.log('insights daily rows:', daily.length, daily[0] ? daily[0].date_start : '(vazio)');
      if (breakdown.error) console.log('breakdown ERRO:', breakdown.error);
      else console.log('breakdown rows:', breakdown.length, breakdown[0] || '(vazio)');
      console.log('video:', video);

      if (agg.length > 0) {
        try {
          const full = await graph.iterateAllEdges(TOKEN, `${metaAdId}/insights`, {
            fields: INSIGHT_FIELDS,
            time_increment: 1,
            time_range: JSON.stringify({
              since: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
              until: new Date().toISOString().slice(0, 10),
            }),
            limit: 7,
          });
          console.log('INSIGHT_FIELDS (7 dias) rows:', full.length, full.length ? 'OK' : 'vazio');
        } catch (e) {
          console.log('INSIGHT_FIELDS ERRO:', e.message);
        }
      }
    } catch (e) {
      console.log('FALHA:', e.message);
    }
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
