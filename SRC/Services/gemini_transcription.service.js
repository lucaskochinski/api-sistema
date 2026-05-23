'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const integrationConfig = require('./integration_config.service');

const TRANSCRIBE_PROMPT = `Transcreva integralmente o áudio deste vídeo/anúncio em português (ou no idioma falado).
Preserve pontuação básica e parágrafos quando fizer sentido.
Responda APENAS com o texto transcrito, sem comentários, títulos ou Markdown.`;

function requireGeminiKey() {
  const fromConfig = integrationConfig.get('gemini_api_key');
  if (fromConfig) return fromConfig;
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY']) {
    if (process.env[k] && String(process.env[k]).trim()) return String(process.env[k]).trim();
  }
  throw new Error('GEMINI_API_KEY_not_configured');
}

function isGeminiConfigured() {
  try {
    requireGeminiKey();
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeMimeForGemini(mimeType) {
  const mt = String(mimeType || 'video/mp4').trim().toLowerCase();
  if (mt.startsWith('audio/') || mt.startsWith('video/')) return mt;
  return 'video/mp4';
}

/**
 * Transcreve buffer de áudio/vídeo via Gemini (fallback quando Deepgram indisponível).
 * @returns {Promise<{ transcript: string, confidence: number|null, durationSeconds: number|null, meta: object }>}
 */
async function transcribeMediaBuffer(mediaBuffer, options = {}) {
  const buffer = Buffer.isBuffer(mediaBuffer) ? mediaBuffer : Buffer.from(mediaBuffer || []);
  if (!buffer.length) {
    const err = new Error('gemini_transcription_empty_buffer');
    err.statusCode = 422;
    throw err;
  }

  const maxBytes = Number(process.env.GEMINI_TRANSCRIBE_MAX_BYTES || 15 * 1024 * 1024);
  if (buffer.length > maxBytes) {
    const err = new Error('gemini_transcription_file_too_large');
    err.statusCode = 422;
    err.details = { maxBytes, actualBytes: buffer.length };
    throw err;
  }

  const modelName =
    options.model ||
    process.env.GEMINI_TRANSCRIBE_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-2.5-flash';

  const genAI = new GoogleGenerativeAI(requireGeminiKey());
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  });

  const mimeType = normalizeMimeForGemini(options.mimeType);

  let textOut;
  try {
    const res = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      },
      { text: TRANSCRIBE_PROMPT },
    ]);
    textOut = res.response?.text?.() ?? '';
  } catch (e) {
    const wrapped = new Error('gemini_transcription_failed');
    wrapped.cause = e;
    throw wrapped;
  }

  const transcript = String(textOut || '').trim();
  if (!transcript) {
    const err = new Error('gemini_empty_transcript');
    err.details = 'no_transcript_segments';
    throw err;
  }

  return {
    transcript,
    confidence: null,
    durationSeconds: options.durationSeconds != null ? Number(options.durationSeconds) : null,
    meta: {
      provider: 'gemini',
      model: modelName,
      mimeType,
      bytes: buffer.length,
    },
  };
}

module.exports = {
  transcribeMediaBuffer,
  isGeminiConfigured,
};
