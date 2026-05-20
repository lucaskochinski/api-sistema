'use strict';

/**
 * Script de Teste / Diagnóstico da API do Meta Ads
 * 
 * Este script emula o processo de buscar contas de anúncios, campanhas e anúncios 
 * diretamente do Facebook usando o Access Token e mostra exatamente 
 * a estrutura dos dados retornados para acompanhamento.
 */

// Injetando as variáveis de ambiente fornecidas para o teste
process.env.META_APP_ID = '496590912982860';
// Deixando o secret dinâmico (buscando do ENV se rodar com "META_APP_SECRET=xyz node test_meta_api.js")
process.env.META_APP_SECRET = process.env.META_APP_SECRET || ''; 
process.env.META_REDIRECT_URI = 'https://sistema-api.szpytu.easypanel.host/api/meta/oauth/callback';
process.env.META_OAUTH_SCOPES = 'ads_read,ads_management,public_profile';
process.env.META_GRAPH_API_VERSION = 'v25.0';

const graph = require('./SRC/Services/meta_graph.client');
const readline = require('readline');
const axios = require('axios');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('======================================================');
console.log('🚀 TESTE DE INTEGRAÇÃO DO META GRAPH API (HOOKO) 🚀');
console.log('======================================================\n');

const authUrl = `https://www.facebook.com/${process.env.META_GRAPH_API_VERSION}/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${process.env.META_REDIRECT_URI}&scope=${process.env.META_OAUTH_SCOPES}&response_type=code`;

console.log('👉 PASSO 1: Autorização');
console.log('Abra a URL abaixo no navegador e autorize o aplicativo Hooko:\n');
console.log('\x1b[36m%s\x1b[0m', authUrl); // Print in Cyan color
console.log('\nApós autorizar, você será redirecionado. Copie o parâmetro "code=" da URL final.');
console.log('DICA: Se você já tiver um Access Token (EAA...), pode colá-lo diretamente também.\n');

rl.question('Cole aqui o CODE ou o ACCESS TOKEN: ', async (input) => {
  let token = input.trim();
  
  if (!token) {
    console.log('❌ Erro: Você não forneceu um token/code.');
    process.exit(1);
  }

  // Se o input não começar com 'EAA' (padrão de tokens Meta), assumimos que é o CODE (OAuth)
  if (!token.startsWith('EAA')) {
    console.log('\n🔄 CODE identificado! Trocando o código pelo Access Token na Graph API...');
    try {
      const res = await axios.get(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION}/oauth/access_token`, {
        params: {
          client_id: process.env.META_APP_ID,
          redirect_uri: process.env.META_REDIRECT_URI,
          client_secret: process.env.META_APP_SECRET,
          code: token
        }
      });
      token = res.data.access_token;
      console.log('✅ Access Token gerado com sucesso: \x1b[32m%s\x1b[0m', token.substring(0, 30) + '...');
    } catch (e) {
      console.error('\n❌ Erro ao trocar code pelo token:');
      console.error(e.response?.data || e.message);
      if (!process.env.META_APP_SECRET) {
        console.log('\n⚠️ NOTA IMPORTANTE: Para gerar o token a partir do código OAuth, você DEVE fornecer o META_APP_SECRET.');
        console.log('Rode este script novamente com o secret na frente:');
        console.log('META_APP_SECRET=seu_secret_aqui node test_meta_api.js');
      }
      process.exit(1);
    }
  } else {
    console.log('\n✅ Access Token direto detectado!');
  }

  try {
    console.log('\n------------------------------------------------------');
    console.log('👉 PASSO 2: Buscando Ad Accounts vinculadas...');
    console.log(`Endpoint: GET /me/adaccounts (usando módulo meta_graph.client local)`);
    
    // Testamos a busca de Ad Accounts (IDs para iniciar o funnel de requisições)
    const accounts = await graph.iterateAllEdges(token, 'me/adaccounts', { fields: 'id,name,account_status' });
    console.log(`\x1b[32m%s\x1b[0m`, `Contas de Anúncio Encontradas: ${accounts.length}`);
    accounts.forEach(acc => console.log(`   - [ID: ${acc.id}] ${acc.name || 'Sem nome'} (Status: ${acc.account_status})`));

    let foundAd = null;
    let foundCampaignId = null;
    let foundActId = null;

    console.log('\n------------------------------------------------------');
    console.log('👉 PASSO 3: Procurando ativamente um Anúncio (Ad) nas suas contas...');
    
    for (const acc of accounts) {
      if (foundAd) break;
      const actId = acc.id;
      
      const campaigns = await graph.iterateAllEdges(token, `${actId}/campaigns`, {
        fields: 'id,name',
        limit: 10
      }).catch(() => []);

      for (const c of campaigns) {
        if (foundAd) break;
        
        const ads = await graph.iterateAllEdges(token, `${c.id}/ads`, {
          fields: 'id,name,status,creative{id,name,thumbnail_url,video_id,image_url}',
          limit: 5
        }).catch(() => []);

        if (ads && ads.length > 0) {
          foundAd = ads[0];
          foundCampaignId = c.id;
          foundActId = actId;
          break;
        }
      }
    }

    if (foundAd) {
      console.log(`\n✅ SUCESSO! Encontramos um anúncio ativo para testes.`);
      console.log(`   - Conta: ${foundActId}`);
      console.log(`   - Campanha: ${foundCampaignId}`);
      console.log(`   - Anúncio: ${foundAd.name} [ID: ${foundAd.id}]`);
      
      console.log('\n------------------------------------------------------');
      console.log('👉 PASSO 4: Simulando a hidratação do criativo (Processo Backend -> Frontend)...');
      
      const creative = foundAd.creative || {};
      let videoData = null;

      if (creative.video_id) {
        console.log(`🎥 Vídeo detectado (ID: ${creative.video_id})! Buscando a URL crua (source) e Thumbnails profundas...`);
        try {
          const vhead = await graph.fbGet(token, String(creative.video_id), {
            fields: 'source,picture,thumbnails',
          });
          videoData = vhead;
          console.log(`✅ Vídeo carregado com sucesso!`);
        } catch (e) {
          console.log(`❌ Erro ao buscar os dados profundos do vídeo: ${e.message}`);
        }
      } else {
        console.log(`🖼️ Imagem detectada. Puxando metadados de imagem...`);
      }

      console.log('\n📦 PAYLOAD FINAL QUE VAI PARA O FRONTEND (AI ANALYSIS / PREVIEW):');
      const payloadFront = {
        ad_id: foundAd.id,
        ad_name: foundAd.name,
        status: foundAd.status,
        creative_id: creative.id,
        thumbnail_url: videoData?.picture || creative.thumbnail_url || creative.image_url || null,
        video_url: videoData?.source || null,
        is_video: !!creative.video_id,
        raw_meta_payload: { ...creative }
      };

      console.log(JSON.stringify(payloadFront, null, 2));

      console.log('\n------------------------------------------------------');
      console.log('👉 PASSO 5: Buscando Estatísticas (Insights) do Anúncio...');
      console.log(`Endpoint: GET /${foundAd.id}/insights?date_preset=maximum`);
      
      try {
        const insightsData = await graph.iterateAllEdges(token, `${foundAd.id}/insights`, {
          fields: 'spend,impressions,clicks,cpc,cpm,ctr,actions',
          date_preset: 'maximum' // Traz o histórico todo para garantir que vem algo
        }).catch(() => []);

        if (insightsData && insightsData.length > 0) {
          console.log(`✅ Estatísticas encontradas:`);
          const stats = insightsData[0]; // Geralmente vem um objeto consolidado
          console.log(`   - Gasto (Spend): $${stats.spend || '0.00'}`);
          console.log(`   - Impressões: ${stats.impressions || '0'}`);
          console.log(`   - Cliques: ${stats.clicks || '0'}`);
          console.log(`   - CPC (Custo por Clique): $${stats.cpc || '0.00'}`);
          console.log(`   - CTR (Taxa de Clique): ${stats.ctr || '0'}%`);
          console.log(`\n📦 Payload de Insights puro retornado pelo Meta:`);
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(`⚠️ Nenhuma estatística/gasto encontrado para este anúncio no período máximo.`);
        }
      } catch (e) {
        console.log(`❌ Erro ao buscar insights: ${e.message}`);
      }

    } else {
      console.log('\n⚠️ Varremos suas contas recentes mas não encontramos campanhas com anúncios cadastrados (ou sem permissão de leitura nos criativos).');
    }
    
    console.log('\n======================================================');
    console.log('✅ SCRIPT FINALIZADO COM SUCESSO!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERRO NA INTEGRAÇÃO/REQUISIÇÃO DO META:');
    console.error(error.response?.data || error.message || error);
    process.exit(1);
  }
});
