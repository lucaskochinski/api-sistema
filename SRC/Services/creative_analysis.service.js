'use strict';

const {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} = require('@google/generative-ai');
const integrationConfig = require('./integration_config.service');

const SAVE_HOLISTIC_FN = 'save_holistic_creative_analysis';
const SAVE_TRANSCRIPT_FN = 'save_transcript_analysis';

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

Depois de analisar, chame a função \`${SAVE_HOLISTIC_FN}\` com os resultados. Não responda em texto livre — use apenas a tool.

Se algum campo de texto acima estiver vazio ou "(não informado)", reflita nas sugestões e não invente copy que não exista.`;

const TRANSCRIPT_ANALYSIS_PROMPT_TEMPLATE = `Você é analista criativo especializado em anúncios de vídeo (Meta Ads).

Com base apenas na TRANSCRIÇÃO falada do criativo abaixo, produza recomendações práticas.
Depois de analisar, chame a função \`${SAVE_TRANSCRIPT_FN}\` com os resultados. Não responda em texto livre — use apenas a tool.

Se falta texto útil ou transcrição muito curta, ainda assim preencha com hipótese fraca marcando gancho inadequado explicitamente nas sugestões.

TRANSCRIÇÃO:
<<<TRANSCRIPT_BODY>>>`;

const HOLISTIC_FUNCTION_DECLARATION = {
  name: SAVE_HOLISTIC_FN,
  description:
    'Persiste a análise holística do criativo: notas por dimensão, harmonia vídeo×texto e sugestões.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      notas: {
        type: SchemaType.OBJECT,
        description: 'Notas de 0 a 100 por dimensão.',
        properties: {
          gancho: { type: SchemaType.INTEGER, description: '0-100' },
          oferta: { type: SchemaType.INTEGER, description: '0-100' },
          prova_social: { type: SchemaType.INTEGER, description: '0-100' },
          cta: { type: SchemaType.INTEGER, description: '0-100' },
        },
        required: ['gancho', 'oferta', 'prova_social', 'cta'],
      },
      harmonia_entre_video_e_texto: {
        type: SchemaType.STRING,
        description: '1-4 frases objetivas sobre alinhamento vídeo × copy.',
      },
      sugestoes: {
        type: SchemaType.ARRAY,
        description: 'Até 8 bullets práticos.',
        items: { type: SchemaType.STRING },
      },
    },
    required: ['notas', 'harmonia_entre_video_e_texto', 'sugestoes'],
  },
};

const TRANSCRIPT_FUNCTION_DECLARATION = {
  name: SAVE_TRANSCRIPT_FN,
  description: 'Persiste análise da transcrição: gancho, nota geral e sugestões.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      gancho: {
        type: SchemaType.STRING,
        description: 'Frase curta destacando o gancho ou problema principal.',
      },
      nota: {
        type: SchemaType.INTEGER,
        description: 'Nota reputacional do discurso comercial, 0-100.',
      },
      sugestoes: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
    },
    required: ['gancho', 'nota', 'sugestoes'],
  },
};

function requireApiKey() {
  const fromConfig = integrationConfig.get('gemini_api_key');
  if (fromConfig) return fromConfig;
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

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((s) => String(s)).filter(Boolean) : [];
}

async function invokeGeminiStructuredOnce(prompt, functionDeclaration, options = {}) {
  const modelName = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const genAI = new GoogleGenerativeAI(requireApiKey());
  const model = genAI.getGenerativeModel({
    model: modelName,
    tools: [{ functionDeclarations: [functionDeclaration] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: [functionDeclaration.name],
      },
    },
    generationConfig: {
      temperature: options.temperature ?? 0.52,
      maxOutputTokens: 2048,
    },
  });

  let response;
  try {
    const res = await model.generateContent(prompt);
    response = res.response;
  } catch (e) {
    const wrapped = new Error('gemini_generate_failed');
    wrapped.cause = e;
    throw wrapped;
  }

  const calls = response.functionCalls?.();
  const firstCall = Array.isArray(calls) && calls.length ? calls[0] : null;
  if (firstCall?.args && typeof firstCall.args === 'object') {
    return { parsed: firstCall.args, modelName, via: 'function_call' };
  }

  let textOut = '';
  try {
    textOut = response.text?.() ?? '';
  } catch (_) {
    textOut = '';
  }

  if (!textOut) {
    throw new Error('gemini_empty_response');
  }

  const cleaned = sanitizeJsonSnippet(textOut);
  try {
    return { parsed: JSON.parse(cleaned), modelName, via: 'json_text' };
  } catch (e3) {
    const err = new Error('gemini_structured_output_failed');
    err.cause = e3;
    err.details = { rawPreview: textOut.slice(0, 500) };
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chama Gemini com function calling obrigatório; fallback para JSON em texto.
 * @returns {Promise<{ parsed: object, modelName: string, via: 'function_call'|'json_text' }>}
 */
async function invokeGeminiStructured(prompt, functionDeclaration, options = {}) {
  const maxAttempts = Number(process.env.GEMINI_STRUCTURED_MAX_ATTEMPTS || 3);
  const retryable = new Set(['gemini_empty_response', 'gemini_structured_output_failed']);
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await invokeGeminiStructuredOnce(prompt, functionDeclaration, options);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && retryable.has(err.message)) {
        await sleep(400 * attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

function buildHolisticResult(parsed, modelName, via) {
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
  const sugestoes = normalizeStringList(parsed.sugestoes);

  return {
    notas: { gancho: g, oferta: o, prova_social: ps, cta: ctaSc },
    harmonia_entre_video_e_texto: harmonia,
    sugestoes,
    /** Compatível com payloads antigos */
    gancho: `Gancho ${g}/100 — ${harmonia ? harmonia.slice(0, 200) : 'ver sugestões'}`,
    nota: String(media),
    modelUsed: modelName,
    generatedAt: new Date().toISOString(),
    outputVia: via,
    holisticRaw: parsed,
  };
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

  const prompt = HOLISTIC_PAID_PROMPT_TEMPLATE.replace('<<<TRANSCRIPT>>>', trimmed)
    .replace('<<<PRIMARY>>>', primary)
    .replace('<<<HEADLINE>>>', headline)
    .replace('<<<CTA>>>', cta);

  const { parsed, modelName, via } = await invokeGeminiStructured(
    prompt,
    HOLISTIC_FUNCTION_DECLARATION,
    { ...options, temperature: options.temperature ?? 0.52 },
  );

  return buildHolisticResult(parsed, modelName, via);
}

/**
 * Gera objeto insights { gancho, nota (string número), sugestoes[] }
 */
async function generateCreativeInsightsFromTranscript(transcript, options = {}) {
  const trimmed = String(transcript || '').trim().slice(
    0,
    Number(process.env.GEMINI_MAX_TRANSCRIPT_CHARS || 120_000),
  );

  const prompt = TRANSCRIPT_ANALYSIS_PROMPT_TEMPLATE.replace('<<<TRANSCRIPT_BODY>>>', trimmed);
  const { parsed, modelName, via } = await invokeGeminiStructured(
    prompt,
    TRANSCRIPT_FUNCTION_DECLARATION,
    { ...options, temperature: options.temperature ?? 0.55 },
  );

  const notaParsed =
    typeof parsed.nota === 'number'
      ? String(parsed.nota)
      : parsed.nota != null
        ? String(parsed.nota).replace(/%/g, '')
        : '0';

  return {
    gancho: parsed.gancho != null ? String(parsed.gancho) : '',
    nota: notaParsed,
    sugestoes: normalizeStringList(parsed.sugestoes),
    modelUsed: modelName,
    generatedAt: new Date().toISOString(),
    outputVia: via,
  };
}

module.exports = {
  generateCreativeInsightsFromTranscript,
  generateCreativeInsightsHolistic,
};
