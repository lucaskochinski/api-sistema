'use strict';

/** Payload UI partilhado entre API e frontend — scores dos cards/gráficos de IA. */

const INSIGHT_COPY = {
  gancho: {
    title: 'Gancho forte',
    description: 'Prende a atenção nos 3 primeiros segundos.',
  },
  prova: {
    title: 'Prova clara',
    description: 'Aumenta confiança e credibilidade.',
  },
  oferta: {
    title: 'Oferta relevante',
    description: 'Conecta desejo com dor do público.',
  },
  cta: {
    title: 'CTA directo',
    description: 'Estimula acção imediata e conversão.',
  },
};

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function readDetailedScores(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const detailed = raw.notasDetalhadas || raw.notas_detalhadas || raw.notas || raw.ui?.scores;
  if (detailed && typeof detailed === 'object') {
    return {
      gancho: clampScore(detailed.gancho ?? detailed.hook),
      oferta: clampScore(detailed.oferta ?? detailed.offer),
      prova: clampScore(detailed.prova_social ?? detailed.prova ?? detailed.social_proof),
      cta: clampScore(detailed.cta),
    };
  }
  return {
    gancho: clampScore(raw.hook_score ?? raw.hookScore),
    oferta: clampScore(raw.offer_score ?? raw.offerScore),
    prova: clampScore(raw.social_proof_score ?? raw.socialProofScore),
    cta: clampScore(raw.cta_score ?? raw.ctaScore),
  };
}

function readHarmonia(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = raw.harmonia_entre_video_e_texto ?? raw.harmonia ?? raw.feedback;
  if (typeof text === 'number') return clampScore(text);
  if (typeof text === 'string' && /^\d+$/.test(text.trim())) return clampScore(text);
  return null;
}

function computeRetentionScore(videoMetrics, detailed) {
  const vm = videoMetrics && typeof videoMetrics === 'object' ? videoMetrics : {};
  if (vm.retention75Pct != null) return clampScore(vm.retention75Pct);
  if (vm.retention75_pct != null) return clampScore(vm.retention75_pct);

  const plays = Number(vm.plays ?? vm.videoPlays ?? vm.video_plays) || 0;
  const p75 = Number(vm.watched75pct ?? vm.watched_75pct ?? vm.video75) || 0;
  if (plays > 0 && p75 >= 0) return clampScore((p75 / plays) * 100);

  if (vm.hookRatePct != null) return clampScore(vm.hookRatePct);

  if (detailed.gancho != null && detailed.prova != null) {
    return clampScore((detailed.gancho + detailed.prova) / 2);
  }
  return null;
}

function computeFormatScore(detailed, harmonia, videoMetrics) {
  if (harmonia != null) return harmonia;
  const vm = videoMetrics && typeof videoMetrics === 'object' ? videoMetrics : {};
  if (vm.hookRatePct != null && detailed.gancho != null) {
    return clampScore((Number(vm.hookRatePct) + detailed.gancho) / 2);
  }
  const values = [detailed.gancho, detailed.oferta, detailed.prova, detailed.cta].filter(
    (v) => v != null,
  );
  if (!values.length) return null;
  return clampScore(values.reduce((a, b) => a + b, 0) / values.length);
}

function averageScores(values) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return null;
  return clampScore(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function readSuggestions(raw) {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.sugestoes)) return raw.sugestoes.map(String).filter(Boolean);
  if (typeof raw.sugestoes === 'string' && raw.sugestoes.trim()) return [raw.sugestoes.trim()];
  return [];
}

function scalePotentialLabel(score) {
  if (score == null) return null;
  if (score >= 85) return 'Alto potencial de escala';
  if (score >= 70) return 'Potencial moderado de escala';
  return 'Precisa optimizar antes de escalar';
}

function scoreTone(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'muted';
  if (n >= 80) return 'good';
  if (n >= 65) return 'mid';
  return 'low';
}

/**
 * Normaliza ai_analysis + métricas Meta para os cards/gráficos HOOKO.
 * @param {Record<string, unknown> | null | undefined} rawAi
 * @param {{ videoMetrics?: Record<string, unknown> | null }} [context]
 */
function buildAiCreativeUi(rawAi, context = {}) {
  if (rawAi?.ui && typeof rawAi.ui === 'object' && !context.videoMetrics) {
    return rawAi.ui;
  }

  const raw = rawAi && typeof rawAi === 'object' ? rawAi : null;
  const detailed = readDetailedScores(raw);
  const harmonia = readHarmonia(raw);
  const retencao = computeRetentionScore(context.videoMetrics, detailed);
  const formato = computeFormatScore(detailed, harmonia, context.videoMetrics);

  const performanceScore =
    clampScore(raw?.nota) ??
    averageScores([
      detailed.gancho,
      retencao,
      detailed.oferta,
      detailed.prova,
      detailed.cta,
      formato,
    ]);

  const pending = performanceScore == null && !raw;

  const insights = [
    { key: 'gancho', ...INSIGHT_COPY.gancho, score: detailed.gancho },
    { key: 'prova', ...INSIGHT_COPY.prova, score: detailed.prova },
    { key: 'oferta', ...INSIGHT_COPY.oferta, score: detailed.oferta },
    { key: 'cta', ...INSIGHT_COPY.cta, score: detailed.cta },
  ];

  const verdict =
    (typeof raw?.harmonia_entre_video_e_texto === 'string' && raw.harmonia_entre_video_e_texto) ||
    (typeof raw?.gancho === 'string' && raw.gancho) ||
    (typeof raw?.feedback === 'string' && raw.feedback) ||
    '';

  return {
    pending,
    performanceScore,
    successProbability: performanceScore,
    scores: {
      gancho: detailed.gancho,
      retencao,
      oferta: detailed.oferta,
      prova: detailed.prova,
      cta: detailed.cta,
      formato,
      harmonia,
    },
    chartSeries: [
      { key: 'gancho', label: 'Gancho', value: detailed.gancho || 0 },
      { key: 'oferta', label: 'Oferta', value: detailed.oferta || 0 },
      { key: 'prova', label: 'Prova', value: detailed.prova || 0 },
      { key: 'cta', label: 'CTA', value: detailed.cta || 0 },
      { key: 'harmonia', label: 'Harmonia', value: harmonia ?? formato ?? 0 },
    ],
    metrics: [
      { key: 'gancho', label: 'Gancho', value: detailed.gancho },
      { key: 'retencao', label: 'Retenção', value: retencao },
      { key: 'oferta', label: 'Oferta', value: detailed.oferta },
      { key: 'prova', label: 'Prova', value: detailed.prova },
      { key: 'cta', label: 'CTA', value: detailed.cta },
      { key: 'formato', label: 'Formato', value: formato },
    ],
    insights,
    verdict,
    suggestions: readSuggestions(raw),
    scalePotential: scalePotentialLabel(performanceScore),
    scoreTone: scoreTone(performanceScore),
    analyzedPipeline: raw?.analyzedPipeline || raw?.analyzed_pipeline || null,
    llmModel: raw?.llmModel || raw?.llm_model || null,
  };
}

module.exports = {
  buildAiCreativeUi,
  scoreTone,
};
