'use strict';

require('dotenv').config();

const { sequelize, Organization, IntegrationsMeta, MetaAdAccount } = require('./Models');
const cipher = require('./Utils/crypto');
const axios = require('axios');

async function seed() {
  const token = process.argv[2] || process.env.META_ACCESS_TOKEN;
  
  if (!token) {
    console.error('❌ ERRO: Forneça o token como argumento do script ou defina META_ACCESS_TOKEN no .env.');
    console.log('Uso: node SRC/seed_token.js <META_ACCESS_TOKEN>');
    process.exit(1);
  }

  console.log('🔄 Iniciando seeding do Meta Access Token...');

  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao PostgreSQL com sucesso.');

    // 1. Obter a primeira organização cadastrada no banco
    const org = await Organization.findOne();
    if (!org) {
      console.error('❌ ERRO: Nenhuma organização encontrada no banco de dados. Cadastre uma organização primeiro no sistema.');
      process.exit(1);
    }
    const organizationId = org.id;
    console.log(`🏢 Organização ativa encontrada: "${org.name}" (ID: ${organizationId})`);

    // 2. Criptografar o token para a tabela integrations_meta
    const aad = String(organizationId);
    const encryptedToken = cipher.encrypt(token, aad);

    // 3. Obter os dados do token usando a Graph API v25.0
    const version = process.env.META_GRAPH_API_VERSION || 'v25.0';
    console.log(`🔌 Buscando contas de anúncio vinculadas ao token na Meta (Graph API ${version})...`);
    
    let accountsData = [];
    try {
      const res = await axios.get(`https://graph.facebook.com/${version}/me/adaccounts`, {
        params: {
          fields: 'id,name,account_status',
          access_token: token
        },
        timeout: 20000
      });
      accountsData = res.data?.data || [];
    } catch (err) {
      console.error('⚠️ Aviso ao buscar contas da Meta:', err.response?.data || err.message);
      console.log('Tentando prosseguir apenas com a injeção do token no banco...');
    }

    // 4. Salvar na tabela integrations_meta
    await IntegrationsMeta.upsert({
      organizationId,
      accessTokenCipher: encryptedToken,
      refreshTokenCipher: null,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // Expirar em 60 dias por padrão
      oauthMetadata: {
        graphUserId: 'direct_seed',
        scopes: ['ads_read', 'ads_management'],
        lastValidatedAt: new Date().toISOString()
      },
      status: 'active'
    });

    console.log('✅ Token criptografado e salvo com sucesso em "integrations_meta".');

    // 5. Inserir contas de anúncios em meta_ad_accounts
    if (accountsData.length > 0) {
      console.log(`📦 Encontradas ${accountsData.length} contas de anúncios. Registrando no banco...`);
      for (const account of accountsData) {
        // Remover prefixo 'act_' se houver necessidade ou manter uniforme
        const metaActId = account.id; // act_xxxxxxxx
        const name = account.name || `Conta ${metaActId}`;
        
        await MetaAdAccount.upsert({
          organizationId,
          metaActId,
          name
        });
        
        console.log(`   👉 Conta: ${name} (ID: ${metaActId}) - Status da Meta: ${account.account_status}`);
      }
    } else {
      console.warn('⚠️ Nenhuma conta de anúncio ativa foi listada pelo token.');
    }

    console.log('\n🚀 CONCLUÍDO COM SUCESSO!');
    console.log('========================================================================');
    console.log(`🔑 Organização ID: ${organizationId}`);
    if (accountsData.length > 0) {
      const sampleAccount = accountsData[0];
      console.log(`📈 Conta de anúncios sugerida para testes: ${sampleAccount.id}`);
      console.log('\nPara sincronizar campanhas via API, use a seguinte rota:');
      console.log(`GET /api/metasync/account/${sampleAccount.id}/live-campaigns`);
    }
    console.log('========================================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Falha ao executar o seeding:', error);
    process.exit(1);
  }
}

seed();
