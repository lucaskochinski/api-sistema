'use strict';

/**
 * Seed manual: importa anúncio demo + transcrição + análise Gemini → creative_analyses.
 *
 * Requisitos: Postgres, GEMINI_API_KEY, META_SYSTEM_ACCESS_TOKEN no .env
 *
 *   node seed_demo_ad_analysis.js
 *   META_DEMO_AI_FORCE=true node seed_demo_ad_analysis.js
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const { loadIntegrationConfig } = require('./SRC/Services/integration_config.service');

async function main() {
  await loadIntegrationConfig().catch(() => {});

  const db = require('./SRC/Models');
  await db.sequelize.authenticate();

  const { ensureDemoAdAiAnalysisSeeded } = require('./SRC/Services/demo_ad_ai_seed.service');
  const result = await ensureDemoAdAiAnalysisSeeded();

  if (!result) {
    console.error('Seed demo IA não concluído. Verifique Postgres, GEMINI e META_SYSTEM_ACCESS_TOKEN.');
    process.exit(1);
  }

  console.log('\n--- Resultado ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nAbra no browser:', result.frontendUrl);
  await db.sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
