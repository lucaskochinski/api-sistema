'use strict';

const geminiTranscription = require('./gemini_transcription.service');

/**
 * Transcrição de vídeo/áudio — apenas Google Gemini.
 */
async function transcribeMediaBuffer(mediaBuffer, options = {}) {
  if (!geminiTranscription.isGeminiConfigured()) {
    const err = new Error('GEMINI_API_KEY_not_configured');
    err.statusCode = 503;
    err.details = 'Defina GEMINI_API_KEY no .env ou Admin → Integrações';
    throw err;
  }

  const gem = await geminiTranscription.transcribeMediaBuffer(mediaBuffer, options);
  return {
    ...gem,
    provider: 'gemini',
  };
}

module.exports = {
  transcribeMediaBuffer,
  isGeminiConfigured: geminiTranscription.isGeminiConfigured,
};
