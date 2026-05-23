'use strict';

const deepgramService = require('./deepgram.service');
const geminiTranscription = require('./gemini_transcription.service');
const integrationConfig = require('./integration_config.service');

function isDeepgramConfigured() {
  const fromConfig = integrationConfig.get('deepgram_api_key');
  if (fromConfig) return true;
  return Boolean(process.env.DEEPGRAM_API_KEY && String(process.env.DEEPGRAM_API_KEY).trim());
}

/**
 * Transcreve vídeo/áudio: Deepgram (preferido) → Gemini (fallback).
 * @returns {Promise<{ transcript: string, confidence: number|null, durationSeconds: number|null, meta: object, provider: string }>}
 */
async function transcribeMediaBuffer(mediaBuffer, options = {}) {
  if (isDeepgramConfigured()) {
    const dg = await deepgramService.transcribeMediaBuffer(mediaBuffer, options);
    return {
      ...dg,
      provider: 'deepgram',
    };
  }

  if (geminiTranscription.isGeminiConfigured()) {
    const gem = await geminiTranscription.transcribeMediaBuffer(mediaBuffer, options);
    return {
      ...gem,
      provider: 'gemini',
    };
  }

  const err = new Error('transcription_provider_not_configured');
  err.statusCode = 503;
  err.details = 'Configure DEEPGRAM_API_KEY ou GEMINI_API_KEY';
  throw err;
}

module.exports = {
  transcribeMediaBuffer,
  isDeepgramConfigured,
  isGeminiConfigured: geminiTranscription.isGeminiConfigured,
};
