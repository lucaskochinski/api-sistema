'use strict';

/**
 * Probe: campos financeiros que a Meta Insights API realmente devolve.
 *
 * Uso:
 *   META_ACCESS_TOKEN=EAA... META_ACT_ID=2496055307427709 node test_meta_financial_probe.js
 *   node test_meta_financial_probe.js EAA... [metaAdId]
 */

process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');
const { INSIGHT_FIELDS, extractDailyMetrics } = require('./SRC/Services/meta_insights_metrics.service');

const TOKEN = process.argv[2] || process.env.META_ACCESS_TOKEN || process.env.META_SYSTEM_ACCESS_TOKEN;
const ACT_ID = process.env.META_ACT_ID || '2496055307427709';
const AD_ID = process.argv[3] || process.env.PROBE_META_AD_ID || '120249726853890230';

const FINANCIAL_FIELDS = [
  'spend',
  'cpc',
  'cpm',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
  'website_purchase_roas',
].join(',');

function actPrefix(id) {
  const s = String(id).trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

function pickFinancial(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const purchaseActions = (raw.actions || []).filter((a) =>
    /purchase|checkout|add_to_cart|lead/i.test(String(a.action_type || '')),
  );
  const purchaseValues = (raw.action_values || []).filter((a) =>
    /purchase|checkout|add_to_cart|lead/i.test(String(a.action_type || '')),
  );
  const roas = raw.purchase_roas || raw.website_purchase_roas || [];

  return {
    date_start: raw.date_start,
    date_stop: raw.date_stop,
    spend: raw.spend,
    purchase_roas: roas,
    actions: purchaseActions,
    action_values: purchaseValues,
    cost_per_action_type: (raw.cost_per_action_type || []).filter((a) =>
      /purchase|checkout/i.test(String(a.action_type || '')),
    ),
  };
}

function summarizeRows(rows) {
  let totalSpend = 0;
  let totalPurchases = 0;
  let totalPurchaseRevenue = 0;

  for (const row of rows) {
    const m = extractDailyMetrics({ raw: row });
    totalSpend += m.spend;
    totalPurchases += m.purchases;
    totalPurchaseRevenue += m.purchaseRevenue;
  }

  return {
    days: rows.length,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalPurchases,
    totalPurchaseRevenue: Math.round(totalPurchaseRevenue * 100) / 100,
    roas: totalSpend > 0 ? Math.round((totalPurchaseRevenue / totalSpend) * 100) / 100 : 0,
  };
}

async function main() {
  if (!TOKEN) {
    console.error('Defina META_ACCESS_TOKEN ou passe token como argv[2]');
    process.exit(1);
  }

  const act = actPrefix(ACT_ID);
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  console.log('Conta:', act);
  console.log('Ad:', AD_ID);
  console.log('Período:', since, '→', until);
  console.log('');

  const acc = await graph.fbGet(TOKEN, act, { fields: 'id,name,currency,account_status' });
  console.log('=== CONTA ===');
  console.log(JSON.stringify(acc, null, 2));

  console.log('\n=== INSIGHTS FINANCEIROS (nível ad, 30d) ===');
  const agg = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
    fields: FINANCIAL_FIELDS,
    date_preset: 'last_30d',
    limit: 5,
  });
  console.log('rows:', agg.length);
  if (agg.length) {
    console.log(JSON.stringify(pickFinancial(agg[0]), null, 2));
  } else {
    console.log('(sem linhas — anúncio sem entrega ou sem permissão)');
  }

  console.log('\n=== INSIGHTS DIÁRIOS (7d, campos financeiros) ===');
  const since7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const daily = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
    fields: FINANCIAL_FIELDS,
    time_increment: 1,
    time_range: JSON.stringify({ since: since7, until }),
    limit: 10,
  });
  console.log('rows:', daily.length);
  for (const row of daily.slice(0, 3)) {
    console.log(JSON.stringify(pickFinancial(row), null, 2));
  }
  console.log('Totais 7d (via extractDailyMetrics):', summarizeRows(daily));

  console.log('\n=== INSIGHT_FIELDS COMPLETO (7d, 1 linha amostra) ===');
  try {
    const full = await graph.iterateAllEdges(TOKEN, `${AD_ID}/insights`, {
      fields: INSIGHT_FIELDS,
      time_increment: 1,
      time_range: JSON.stringify({ since: since7, until }),
      limit: 3,
    });
    console.log('rows:', full.length);
    if (full.length) {
      const sample = full[0];
      const extracted = extractDailyMetrics({ raw: sample });
      console.log('extractDailyMetrics:', {
        spend: extracted.spend,
        purchases: extracted.purchases,
        purchaseRevenue: extracted.purchaseRevenue,
        initiateCheckouts: extracted.initiateCheckouts,
        pageViews: extracted.pageViews,
      });
      console.log('action_values purchase:', pickFinancial(sample)?.action_values);
    }
  } catch (e) {
    console.log('ERRO INSIGHT_FIELDS:', e.message);
  }

  console.log('\n=== TOP 3 ADS POR GASTO (act/insights) ===');
  const topAds = await graph.iterateAllEdges(TOKEN, `${act}/insights`, {
    fields: 'ad_id,ad_name,spend,actions,action_values,purchase_roas',
    level: 'ad',
    date_preset: 'last_30d',
    sort: 'spend_descending',
    limit: 3,
  });
  for (const row of topAds) {
    const fin = pickFinancial(row);
    console.log(`- ${row.ad_name} (${row.ad_id})`);
    console.log('  spend:', fin.spend);
    console.log('  purchase action_values:', fin.action_values);
    console.log('  purchase_roas:', fin.purchase_roas);
  }

  console.log('\n=== O QUE A META NÃO TRAZ (confirmado pela API) ===');
  console.log('- Método de pagamento (Pix/Cartão/Boleto)');
  console.log('- Status de aprovação/reembolso do gateway');
  console.log('- Receita líquida real do checkout (taxas, chargeback, pendente)');
  console.log('- utm_source/campaign do webhook de vendas');
  console.log('');
  console.log('=== O QUE A META TRAZ (se pixel/CAPI configurado) ===');
  console.log('- spend (gasto em ads)');
  console.log('- actions:purchase / omni_purchase (volume atribuído)');
  console.log('- action_values:purchase (valor de conversão atribuído — NÃO é faturamento líquido do gateway)');
  console.log('- purchase_roas (ROAS atribuído pela Meta)');
}

main().catch((e) => {
  console.error(e.message || e);
  if (e.metaFb) console.error(JSON.stringify(e.metaFb, null, 2));
  process.exit(1);
});
