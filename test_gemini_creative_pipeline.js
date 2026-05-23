'use strict';

/**
 * Teste local do pipeline IA — só Gemini (transcrição + análise holística).
 *
 * Uso rápido (só testa a chave + análise, sem vídeo):
 *   node test_gemini_creative_pipeline.js --sample
 *
 * Teste com ficheiro de vídeo/áudio local:
 *   node test_gemini_creative_pipeline.js --video ./meu_criativo.mp4
 *
 * Teste com anúncio já importado na BD (copy real do Meta):
 *   ORGANIZATION_ID=<uuid> AD_ID=<uuid> node test_gemini_creative_pipeline.js --ad
 *
 * Variáveis opcionais no .env: GEMINI_API_KEY, GEMINI_MODEL, HOOKO_DATABASE_URL
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

const creativeAnalysis = require('./SRC/Services/creative_analysis.service');
const geminiTranscription = require('./SRC/Services/gemini_transcription.service');

const SAMPLE_TRANSCRIPT = `
Olá, se você ainda não conhece o nosso método, presta atenção nos próximos segundos.
A gente ajuda empreendedores a escalar anúncios no Meta com criativos que convertem de verdade.
Hoje temos uma oferta especial com garantia de 7 dias. Clica no botão e garante a tua vaga agora.
`.trim();

const SAMPLE_COPY = {
  primaryText: 'Descobre como escalar no Meta Ads com criativos validados.',
  headline: 'Oferta especial — vagas limitadas',
  ctaType: 'LEARN_MORE',
};

function usage() {
  console.log(`
Teste Gemini HOOKO
==================
  node test_gemini_creative_pipeline.js --sample
  node test_gemini_creative_pipeline.js --video ./criativo.mp4
  ORGANIZATION_ID=<uuid> AD_ID=<uuid> node test_gemini_creative_pipeline.js --ad
`);
}

async function runAnalysis(transcript, metaCopy, label) {
  console.log(`\n--- Análise holística (${label}) ---`);
  const insights = await creativeAnalysis.generateCreativeInsightsHolistic(
    transcript,
    metaCopy,
  );
  console.log(JSON.stringify(insights, null, 2));
  return insights;
}

async function testSample() {
  console.log('Modo: --sample (sem vídeo, só Gemini análise)');
  await runAnalysis(SAMPLE_TRANSCRIPT, SAMPLE_COPY, 'sample');
}

async function testVideo(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`ficheiro_nao_encontrado: ${abs}`);
  }
  const buffer = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mimeType =
    ext === '.mp4' || ext === '.m4v'
      ? 'video/mp4'
      : ext === '.mp3'
        ? 'audio/mpeg'
        : ext === '.wav'
          ? 'audio/wav'
          : 'video/mp4';

  console.log(`Modo: --video (${abs}, ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log('A transcrever com Gemini…');

  const tx = await geminiTranscription.transcribeMediaBuffer(buffer, { mimeType });
  console.log('\n--- Transcrição ---');
  console.log(tx.transcript.slice(0, 2000));
  if (tx.transcript.length > 2000) console.log('… (truncado no log)');

  await runAnalysis(tx.transcript, SAMPLE_COPY, 'video');
}

async function testAdFromDb() {
  const organizationId = process.env.ORGANIZATION_ID;
  const adId = process.env.AD_ID;
  if (!organizationId || !adId) {
    throw new Error('Defina ORGANIZATION_ID e AD_ID no ambiente para --ad');
  }

  require('./SRC/Models');
  const db = require('./SRC/Models');
  await db.sequelize.authenticate();

  const ad = await db.Ad.findOne({ where: { id: adId, organizationId } });
  if (!ad) throw new Error('Anúncio não encontrado para esta org');

  const metaCopy = {
    primaryText: ad.primaryText || '',
    headline: ad.headline || '',
    ctaType: ad.ctaType || '',
  };

  console.log(`Modo: --ad (${ad.name}, metaVideoId=${ad.metaVideoId || '—'})`);

  let transcript = SAMPLE_TRANSCRIPT;
  if (ad.metaVideoId) {
    const metaVideoSource = require('./SRC/Services/meta_video_source.service');
    console.log('A baixar vídeo Meta e transcrever com Gemini…');
    const rawCreative =
      ad.rawCreativeData && typeof ad.rawCreativeData === 'object' ? ad.rawCreativeData : null;
    const fetched = await metaVideoSource.fetchVideoMp4ViaGraph(organizationId, ad.metaVideoId, {
      metaAdGraphId: ad.metaAdId || null,
      rawCreative,
    });
    console.log('   playbackStrategy:', fetched.playbackStrategy || '—');
    const tx = await geminiTranscription.transcribeMediaBuffer(fetched.buffer, {
      mimeType: fetched.mimeType,
    });
    transcript = tx.transcript;
    console.log('\n--- Transcrição ---');
    console.log(transcript.slice(0, 2000));
  } else {
    console.log('Anúncio sem metaVideoId — usa transcrição de exemplo.');
  }

  await runAnalysis(transcript, metaCopy, ad.name);
  await db.sequelize.close();
}

async function main() {
  const arg = process.argv[2];

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error('GEMINI_API_KEY não definida. Coloque em hooko--api/.env');
    process.exit(1);
  }

  try {
    if (arg === '--sample') {
      await testSample();
    } else if (arg === '--video') {
      const file = process.argv[3];
      if (!file) throw new Error('Indique o caminho: --video ./ficheiro.mp4');
      await testVideo(file);
    } else if (arg === '--ad') {
      await testAdFromDb();
    } else {
      usage();
      process.exit(arg ? 1 : 0);
    }
    console.log('\n✅ Teste Gemini concluído.');
  } catch (err) {
    console.error('\n❌ Falha:', err.message || err);
    if (err.cause) console.error(err.cause);
    process.exit(1);
  }
}

main();
