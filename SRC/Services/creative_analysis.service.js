'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/** Legado — transcrição isolada (evite em novos fluxos; preferir holistic). */
const ANALYSIS_PROMPT_TEMPLATE = `
Você é analista criativo especializado em anúncios de vídeo (Meta Ads).

Com base apenas na TRANSCRIÇÃO falada do criativo abaixo, produza recomendações práticas.
Responda ESTRITAMENTE JSON (sem Markdown, sem comentários) com o schema:
{"gancho":"<string curta destacando primeira frase forte ou problema>","nota":"<0-100 inteiro reputacional do discurso comercial>","sugestoes":["<lista de até 8 itens objetivos>","..."]}.

Se falta texto útil ou transcrição muito curta, ainda assim preencha com hipótese fraca marcando gancho inadequado explicitamente nas sugestões.

TRANSCRIÇÃO:
<<<TRANSCRIPT_BODY>>>`;

const HOLISTIC_PAID_PROMPT_TEMPLATE = `Atue como um especialista em tráfego pago. Analise este anúncio completo.

TRANSCRIÇÃO DO VÍDEO:
<<<TRANSCRIPT>>>

COPY DO POST:
<<<PRIMARY>>>

TÍTULO:
<<<HEADLINE>>>

BOTÃO CTA:
<<<CTA>>>

Considerando a harmonia entre o que é falado no vídeo e o texto escrito (copy, título e intenção do CTA), dê uma nota de 0 a 100 para cada dimensão: Gancho, Oferta, Prova Social e CTA.

Responda ESTRITAMENTE JSON (sem Markdown, sem comentários), schema:
{"notas":{"gancho":<inteiro 0-100>,"oferta":<inteiro 0-100>,"prova_social":<inteiro 0-100>,"cta":<inteiro 0-100>},"harmonia_entre_video_e_texto":"<1-4 frases objetivas>","sugestoes":["<até 8 bullets práticos>"]}.

Se algum campo de texto acima estiver vazio ou "(não informado)", reflita nas sugestões e não invente copy que não exista.`;

function requireApiKey() {
  const keys = ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY'];
  for (const k of keys) {
    if (process.env[k] && String(process.env[k]).trim()) return String(process.env[k]).trim();
  }
  throw new Error('GEMINI_API_KEY_not_configured');
}

function sanitizeJsonSnippet(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '{}';
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function clampScore(n, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(100, Math.max(0, Math.round(x)));
}

/**
 * Gemini com transcrição + copy persistida no Ad (Meta).
 * @param {string} transcript
 * @param {{ primaryText?: string, headline?: string, ctaType?: string }} metaCopy
 * @param {object} [options]
 */
async function generateCreativeInsightsHolistic(transcript, metaCopy = {}, options = {}) {
  const trimmed = String(transcript || '').trim().slice(
    0,
    Number(process.env.GEMINI_MAX_TRANSCRIPT_CHARS || 120_000),
  );
  const primary = String(metaCopy.primaryText || '').trim() || '(não informado)';
  const headline = String(metaCopy.headline || '').trim() || '(não informado)';
  const cta = String(metaCopy.ctaType || '').trim() || '(não informado)';

  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const genAI = new GoogleGenerativeAI(requireApiKey());
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.52,
      maxOutputTokens: 2048,
    },
  });

  const prompt = HOLISTIC_PAID_PROMPT_TEMPLATE.replace('<<<TRANSCRIPT>>>', trimmed)
    .replace('<<<PRIMARY>>>', primary)
    .replace('<<<HEADLINE>>>', headline)
    .replace('<<<CTA>>>', cta);

  let textOut;
  try {
    const res = await model.generateContent(prompt);
    textOut = res.response?.text?.() ?? '';
    if (!textOut) throw new Error('gemini_empty_response');
  } catch (e) {
    const wrapped = new Error('gemini_generate_failed');
    wrapped.cause = e;
    throw wrapped;
  }

  const cleaned = sanitizeJsonSnippet(textOut);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e3) {
    const err = new Error('gemini_json_parse_failed');
    err.cause = e3;
    throw err;
  }

  const notas = parsed.notas && typeof parsed.notas === 'object' ? parsed.notas : {};
  const g = clampScore(notas.gancho);
  const o = clampScore(notas.oferta);
  const ps = clampScore(notas.prova_social);
  const ctaSc = clampScore(notas.cta);
  const media = Math.round((g + o + ps + ctaSc) / 4);

  const harmonia =
    parsed.harmonia_entre_video_e_texto != null
      ? String(parsed.harmonia_entre_video_e_texto)
      : '';
  const sugestoes = Array.isArray(parsed.sugestoes)
    ? parsed.sugestoes.map((s) => String(s)).filter(Boolean)
    : [];

  return {
    notas: { gancho: g, oferta: o, prova_social: ps, cta: ctaSc },
    harmonia_entre_video_e_texto: harmonia,
    sugestoes,
    /** Compatível com payloads antigos */
    gancho: `Gancho ${g}/100 — ${harmonia ? harmonia.slice(0, 200) : 'ver sugestões'}`,
    nota: String(media),
    modelUsed: modelName,
    generatedAt: new Date().toISOString(),
    holisticRaw: parsed,
  };
}

/**
 * Gera objeto insights { gancho, nota (string número), sugestoes[] }
 */
async function generateCreativeInsightsFromTranscript(transcript, options = {}) {
  const trimmed = String(transcript || '').trim().slice(
    0,
    Number(process.env.GEMINI_MAX_TRANSCRIPT_CHARS || 120_000),
  );
  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const genAI = new GoogleGenerativeAI(requireApiKey());
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.55,
      maxOutputTokens: 2048,
    },
  });

  const prompt = ANALYSIS_PROMPT_TEMPLATE.replace('<<<TRANSCRIPT_BODY>>>', trimmed);
  let textOut;
  try {
    const res = await model.generateContent(prompt);
    textOut = res.response?.text?.() ?? '';
    if (!textOut) throw new Error('gemini_empty_response');
  } catch (e) {
    const wrapped = new Error('gemini_generate_failed');
    wrapped.cause = e;
    throw wrapped;
  }

  const cleaned = sanitizeJsonSnippet(textOut);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e3) {
    const err = new Error('gemini_json_parse_failed');
    err.cause = e3;
    throw err;
  }

  /** @type string */
  const notaParsed =
    typeof parsed.nota === 'number'
      ? String(parsed.nota)
      : parsed.nota != null
        ? String(parsed.nota).replace(/%/g, '')
        : '0';

  return {
    gancho: parsed.gancho != null ? String(parsed.gancho) : '',
    nota: notaParsed,
    sugestoes: Array.isArray(parsed.sugestoes)
      ? parsed.sugestoes.map((s) => String(s)).filter(Boolean)
      : [],
    modelUsed: modelName,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  generateCreativeInsightsFromTranscript,
  generateCreativeInsightsHolistic,
};
