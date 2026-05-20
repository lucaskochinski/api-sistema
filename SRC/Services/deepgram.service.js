'use strict';

const axios = require('axios');

/**
 * Deepgram pré-gravado: envia payload binário (vídeo/áudio) e retorna transcrição.
 * Docs: https://developers.deepgram.com/docs/pre-recorded-audio
 */

function apiKey() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key || !key.trim()) {
    throw new Error('DEEPGRAM_API_KEY_not_configured');
  }
  return key.trim();
}

async function transcribeMediaBuffer(mediaBuffer, options = {}) {
  const mime = options.mimeType || options.mimetype || 'video/mp4';
  const model = process.env.DEEPGRAM_MODEL || 'nova-2';
  const lang = process.env.DEEPGRAM_LANGUAGE || 'multi';
  const base = process.env.DEEPGRAM_API_BASE_URL || 'https://api.deepgram.com';
  /** smart_format opcional conforme conta */
  const query = new URLSearchParams({
    model,
    language: lang,
    smart_format: process.env.DEEPGRAM_SMART_FORMAT !== '0' ? 'true' : 'false',
    punctuate: 'true',
  });

  const url = `${base}/v1/listen?${query.toString()}`;
  try {
    const { data } = await axios.post(url, mediaBuffer, {
      headers: {
        Authorization: `Token ${apiKey()}`,
        'Content-Type': mime,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Number(process.env.DEEPGRAM_REQUEST_TIMEOUT_MS || 600000),
      validateStatus: (s) => s === 200,
    });

    /** Formato esperado resultado deepgram prerecord json */
    const channels = data?.results?.channels;
    const transcript =
      channels?.[0]?.alternatives?.[0]?.transcript ||
      data?.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.transcript ||
      '';

    const confidence =
      typeof channels?.[0]?.alternatives?.[0]?.confidence === 'number'
        ? channels[0].alternatives[0].confidence
        : null;

    if (!transcript || String(transcript).trim().length === 0) {
      const err = new Error('deepgram_empty_transcript');
      err.details = 'no_transcript_segments';
      throw err;
    }

    const dur =
      data?.metadata && typeof data.metadata.duration === 'number'
        ? data.metadata.duration
        : null;

    return {
      transcript: String(transcript).trim(),
      confidence,
      durationSeconds: dur,
      meta: {
        provider: 'deepgram',
        model,
        mimeType: mime,
        ...(dur != null ? { durationSeconds: dur } : {}),
      },
    };
  } catch (e) {
    if (e.response && e.response.data) {
      const err = new Error('deepgram_http_error');
      err.statusCode = e.response.status;
      /** Nunca logue corpo inteiro pode conter PII snippet */
      err.details = typeof e.response.data === 'object' ? e.response.data.err_msg : undefined;
      throw err;
    }
    throw e;
  }
}

module.exports = {
  transcribeMediaBuffer,
};
