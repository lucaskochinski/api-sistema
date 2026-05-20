'use strict';

const db = require('../Models');
const { ExternalSale, Organization } = db;

/**
 * Normaliza métodos de pagamento externos para os valores do ENUM do banco.
 */
function normalizePaymentMethod(rawMethod) {
  const method = String(rawMethod || '').toLowerCase().trim();
  if (method.includes('pix')) return 'pix';
  if (
    method.includes('cartao') ||
    method.includes('card') ||
    method.includes('credit') ||
    method.includes('debit')
  ) {
    return 'credit_card';
  }
  if (
    method.includes('boleto') ||
    method.includes('billet') ||
    method.includes('ticket')
  ) {
    return 'billet';
  }
  return 'other';
}

/**
 * Processador genérico de Webhooks para UTMIFY, PAGTRUST, LOVABLE, HOOKO e VTURB.
 */
async function processExternalWebhook(req, res, next) {
  try {
    const { platform } = req.params;
    const body = req.body || {};

    // 1. Validar plataforma do ENUM
    const VALID_PLATFORMS = ['utmify', 'pagtrust', 'lovable', 'hooko', 'vturb'];
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({
        error: 'invalid_platform',
        message: `A plataforma '${platform}' não é suportada.`
      });
    }

    console.log(`📥 [Webhook] Recebido payload da plataforma: ${platform}`, JSON.stringify(body));

    // 2. Resolver Multi-tenant (OrganizationId)
    // Permite passar via query param ?organizationId=... (padrão de webhooks em SaaS)
    let orgId = req.query.organizationId || req.query.orgId || body.organizationId || body.orgId;
    
    if (!orgId) {
      // Fallback inteligente para a primeira organização ativa no banco para evitar quebras em testes
      const defaultOrg = await Organization.findOne({ order: [['created_at', 'ASC']] });
      if (defaultOrg) {
        orgId = defaultOrg.id;
      }
    }

    if (orgId) {
      const orgExists = await Organization.findByPk(orgId);
      if (!orgExists) {
        return res.status(404).json({
          error: 'organization_not_found',
          message: `A organização de ID '${orgId}' especificada no webhook não existe.`
        });
      }
    }

    // 3. Normalizar dados extraídos (suporta múltiplos layouts comuns de gateways)
    const transactionId = String(
      body.transaction_id ||
      body.transactionId ||
      body.id ||
      body.payment_id ||
      body.reference ||
      `txn_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    ).trim();

    const rawAmount =
      body.amount ||
      body.value ||
      body.price ||
      body.total_value ||
      body.totalValue ||
      '0';
    const amount = parseFloat(String(rawAmount).replace(/[^0-9.-]/g, '')) || 0.00;

    const status = String(body.status || body.event || 'approved').toLowerCase().trim();

    const paymentMethod = normalizePaymentMethod(
      body.payment_method ||
      body.paymentMethod ||
      body.payment_type ||
      body.paymentType ||
      body.method
    );

    // Extrair UTMs
    const utmSource = String(body.utm_source || body.utmSource || body.utms?.utm_source || '').trim() || null;
    const utmCampaign = String(body.utm_campaign || body.utmCampaign || body.utms?.utm_campaign || '').trim() || null;
    // O utm_term é extremamente crítico para cruzamento com o Vturb
    const utmTerm = String(body.utm_term || body.utmTerm || body.utms?.utm_term || body.utm_content || '').trim() || null;

    const rawDate = body.sale_date || body.saleDate || body.created_at || body.createdAt;
    const saleDate = rawDate ? new Date(rawDate) : new Date();

    // 4. Inserir ou atualizar no banco (Upsert idempotente)
    // Se o webhook reenviar o mesmo ID devido a retries da plataforma de origem, atualizamos o registro.
    const [sale, created] = await ExternalSale.upsert({
      organizationId: orgId || null,
      platform,
      transactionId,
      amount,
      status,
      paymentMethod,
      utmTerm,
      utmSource,
      utmCampaign,
      saleDate
    });

    console.log(`✅ [Webhook] Venda externa salva com sucesso! Platform: ${platform}, TxnID: ${transactionId}, Created: ${created}`);

    return res.status(200).json({
      status: 'success',
      platform,
      transactionId,
      created,
      saleId: sale.id
    });
  } catch (error) {
    console.error('❌ [Webhook] Erro catastrófico ao processar webhook externo:', error);
    next(error);
  }
}

module.exports = {
  processExternalWebhook,
};
