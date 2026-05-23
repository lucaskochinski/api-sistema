'use strict';

/** Biblioteca fixa de 50 formatos de criativo (referência Google Drive HOOKO). */
const DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1tOSweDC-GsinMp25jOyWl8q1wIvV37s0?usp=sharing';

const CREATIVE_FORMAT_TEMPLATES = [
  { id: 'fmt-01', name: 'UGC Depoimento Rápido', category: 'ugc', aspectRatio: '9:16', durationSec: 15 },
  { id: 'fmt-02', name: 'UGC Antes e Depois', category: 'ugc', aspectRatio: '9:16', durationSec: 30 },
  { id: 'fmt-03', name: 'UGC Unboxing', category: 'ugc', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-04', name: 'UGC Prova Social', category: 'ugc', aspectRatio: '9:16', durationSec: 25 },
  { id: 'fmt-05', name: 'UGC Reação ao Produto', category: 'ugc', aspectRatio: '9:16', durationSec: 18 },
  { id: 'fmt-06', name: 'Hook Visual 3s', category: 'hook', aspectRatio: '9:16', durationSec: 12 },
  { id: 'fmt-07', name: 'Hook Pergunta Direta', category: 'hook', aspectRatio: '9:16', durationSec: 10 },
  { id: 'fmt-08', name: 'Hook Dor + Solução', category: 'hook', aspectRatio: '9:16', durationSec: 15 },
  { id: 'fmt-09', name: 'Hook Contraintuitivo', category: 'hook', aspectRatio: '9:16', durationSec: 8 },
  { id: 'fmt-10', name: 'Hook Lista 3 Motivos', category: 'hook', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-11', name: 'Demonstração Produto', category: 'demo', aspectRatio: '1:1', durationSec: 30 },
  { id: 'fmt-12', name: 'Demonstração Feature', category: 'demo', aspectRatio: '1:1', durationSec: 25 },
  { id: 'fmt-13', name: 'Comparativo A vs B', category: 'demo', aspectRatio: '1:1', durationSec: 35 },
  { id: 'fmt-14', name: 'Tutorial Rápido', category: 'demo', aspectRatio: '9:16', durationSec: 45 },
  { id: 'fmt-15', name: 'Screen Recording App', category: 'demo', aspectRatio: '9:16', durationSec: 30 },
  { id: 'fmt-16', name: 'Oferta Relâmpago', category: 'offer', aspectRatio: '1:1', durationSec: 15 },
  { id: 'fmt-17', name: 'Desconto + Urgência', category: 'offer', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-18', name: 'Frete Grátis + Bônus', category: 'offer', aspectRatio: '1:1', durationSec: 18 },
  { id: 'fmt-19', name: 'Bundle 2 por 1', category: 'offer', aspectRatio: '1:1', durationSec: 22 },
  { id: 'fmt-20', name: 'Cupom Exclusivo', category: 'offer', aspectRatio: '9:16', durationSec: 12 },
  { id: 'fmt-21', name: 'Storytelling Origem', category: 'story', aspectRatio: '9:16', durationSec: 45 },
  { id: 'fmt-22', name: 'Storytelling Cliente', category: 'story', aspectRatio: '9:16', durationSec: 40 },
  { id: 'fmt-23', name: 'Storytelling Fundador', category: 'story', aspectRatio: '9:16', durationSec: 50 },
  { id: 'fmt-24', name: 'Dia a Dia com Produto', category: 'story', aspectRatio: '9:16', durationSec: 35 },
  { id: 'fmt-25', name: 'Problema → Jornada → Resultado', category: 'story', aspectRatio: '9:16', durationSec: 55 },
  { id: 'fmt-26', name: 'Carrossel Benefícios', category: 'carousel', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-27', name: 'Carrossel Prova Social', category: 'carousel', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-28', name: 'Carrossel Comparativo', category: 'carousel', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-29', name: 'Carrossel FAQ', category: 'carousel', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-30', name: 'Carrossel Oferta', category: 'carousel', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-31', name: 'Estático Headline Forte', category: 'static', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-32', name: 'Estático Produto Hero', category: 'static', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-33', name: 'Estático Depoimento Print', category: 'static', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-34', name: 'Estático Oferta Numérica', category: 'static', aspectRatio: '1:1', durationSec: null },
  { id: 'fmt-35', name: 'Estático Checklist', category: 'static', aspectRatio: '4:5', durationSec: null },
  { id: 'fmt-36', name: 'Motion Graphics Stats', category: 'motion', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-37', name: 'Motion Texto Dinâmico', category: 'motion', aspectRatio: '9:16', durationSec: 15 },
  { id: 'fmt-38', name: 'Motion Logo + CTA', category: 'motion', aspectRatio: '1:1', durationSec: 10 },
  { id: 'fmt-39', name: 'Motion Countdown', category: 'motion', aspectRatio: '9:16', durationSec: 12 },
  { id: 'fmt-40', name: 'Motion KPI Resultado', category: 'motion', aspectRatio: '9:16', durationSec: 18 },
  { id: 'fmt-41', name: 'Retargeting Lembrete', category: 'retarget', aspectRatio: '9:16', durationSec: 15 },
  { id: 'fmt-42', name: 'Retargeting Carrinho', category: 'retarget', aspectRatio: '1:1', durationSec: 12 },
  { id: 'fmt-43', name: 'Retargeting Última Chance', category: 'retarget', aspectRatio: '9:16', durationSec: 10 },
  { id: 'fmt-44', name: 'Retargeting Prova Social', category: 'retarget', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-45', name: 'Retargeting FAQ Objeção', category: 'retarget', aspectRatio: '9:16', durationSec: 25 },
  { id: 'fmt-46', name: 'Top of Funnel Educativo', category: 'tofu', aspectRatio: '9:16', durationSec: 40 },
  { id: 'fmt-47', name: 'Middle Funnel Comparação', category: 'mofu', aspectRatio: '9:16', durationSec: 35 },
  { id: 'fmt-48', name: 'Bottom Funnel Fechamento', category: 'bofu', aspectRatio: '9:16', durationSec: 20 },
  { id: 'fmt-49', name: 'VSL Curta 60s', category: 'vsl', aspectRatio: '9:16', durationSec: 60 },
  { id: 'fmt-50', name: 'VSL Mini 30s', category: 'vsl', aspectRatio: '9:16', durationSec: 30 },
].map((item, index) => ({
  ...item,
  sortOrder: index + 1,
  driveFolderUrl: DRIVE_FOLDER_URL,
  description: `Formato ${item.name} — biblioteca HOOKO (${item.aspectRatio}).`,
}));

function listCreativeFormatTemplates() {
  return CREATIVE_FORMAT_TEMPLATES;
}

function getTemplateById(id) {
  return CREATIVE_FORMAT_TEMPLATES.find((t) => t.id === id) || null;
}

module.exports = {
  DRIVE_FOLDER_URL,
  listCreativeFormatTemplates,
  getTemplateById,
};
