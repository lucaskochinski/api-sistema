'use strict';

const db = require('../../../Models');
const { QueryTypes, UniqueConstraintError } = require('sequelize');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'true' || s === '1' || s === 'yes') return true;
  return Boolean(v);
}

/** Para `is_public`: default verdadeiro se o campo vier ausente ou `null`. */
function readIsPublic(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'is_public')) {
    const v = body.is_public;
    if (v === null || v === undefined) return true;
    return coerceBool(v);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isPublic')) {
    const v = body.isPublic;
    if (v === null || v === undefined) return true;
    return coerceBool(v);
  }
  return true;
}

async function listSubscriptions({ limit, offset }) {
  return db.Subscription.findAndCountAll({
    limit,
    offset,
    distinct: true,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: db.Organization,
        as: 'organization',
        attributes: ['id', 'name', 'slug', 'stripeCustomerId'],
        required: false,
      },
      {
        model: db.Plan,
        as: 'plan',
        attributes: [
          'id',
          'tierKey',
          'displayName',
          'stripePriceId',
          'trialDays',
          'isPublic',
          'customOrganizationId',
        ],
        required: false,
      },
    ],
  });
}

async function listInvoices({ limit, offset, status }) {
  const where = {};
  if (status && typeof status === 'string') {
    where.status = status;
  }
  return db.Invoice.findAndCountAll({
    where,
    limit,
    offset,
    distinct: true,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: db.Organization,
        as: 'organization',
        attributes: ['id', 'name', 'slug'],
        required: false,
      },
      {
        model: db.Subscription,
        as: 'subscription',
        attributes: ['id', 'status', 'stripeSubscriptionId'],
        required: false,
      },
    ],
  });
}

async function aggregatesForDashboard() {
  const subsByStatus = await db.sequelize.query(
    `SELECT status AS status, COUNT(*)::int AS count FROM subscriptions GROUP BY status ORDER BY count DESC`,
    { type: QueryTypes.SELECT },
  );

  const invRows = await db.sequelize.query(
    `SELECT COALESCE(SUM(amount_due_cents), 0)::text AS sum_due
     FROM invoices
     WHERE status IN ('open','uncollectible','draft')`,
    { type: QueryTypes.SELECT },
  );

  const sumDueRaw =
    Array.isArray(invRows) && invRows.length && invRows[0]?.sum_due != null ? invRows[0].sum_due : '0';

  return {
    subscriptionsByStatus: subsByStatus || [],
    invoicesOpenAmountDueCents: String(sumDueRaw),
  };
}

/**
 * Cadastro Super Admin: tier, Stripe price, limits, trial, vitrine (`is_public`) e plano exclusivo (`custom_organization_id`).
 * @param {Record<string, unknown>} payload
 */
async function createCommercialPlan(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};

  const tierKey = String(body.tier_key ?? body.tierKey ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const stripePriceIdRaw = String(body.stripe_price_id ?? body.stripePriceId ?? '').trim();
  const limitsRaw = body.limits;

  const err400 = (code) => {
    const err = new Error(code);
    err.statusCode = 400;
    return err;
  };

  if (!tierKey || !/^[a-z0-9](?:[a-z0-9_-]{0,62})$/.test(tierKey)) {
    throw err400('plan_tier_key_invalid');
  }
  if (!name) {
    throw err400('plan_name_required');
  }
  if (!stripePriceIdRaw) {
    throw err400('plan_stripe_price_id_required');
  }

  /** @type {Record<string, unknown>} */
  let limits = {};
  if (limitsRaw != null) {
    if (typeof limitsRaw !== 'object' || Array.isArray(limitsRaw)) {
      throw err400('plan_limits_must_be_object');
    }
    limits = /** @type {Record<string, unknown>} */ (limitsRaw);
  }

  let td =
    body.trial_days != null ? Number(body.trial_days) : body.trialDays != null ? Number(body.trialDays) : 0;
  const trialDays = Number.isFinite(td)
    ? Math.min(Math.max(Math.floor(td), 0), 730)
    : 0;

  const isPublic = readIsPublic(body);

  let customOrganizationId = null;
  const rawCustom =
    body.custom_organization_id != null
      ? body.custom_organization_id
      : body.customOrganizationId != null
        ? body.customOrganizationId
        : null;
  if (rawCustom != null && String(rawCustom).trim() !== '') {
    customOrganizationId = String(rawCustom).trim();
    if (!UUID_RE.test(customOrganizationId)) {
      throw err400('custom_organization_id_invalid');
    }
    const orgExists = await db.Organization.findByPk(customOrganizationId, {
      attributes: ['id'],
    });
    if (!orgExists) {
      throw err400('custom_organization_not_found');
    }
  }

  try {
    const plan = await db.Plan.create({
      tierKey,
      displayName: name,
      stripePriceId: stripePriceIdRaw,
      limits,
      trialDays,
      isPublic,
      customOrganizationId,
      isActive: true,
    });
    return plan.get({ plain: true });
  } catch (e) {
    if (e instanceof UniqueConstraintError) {
      const dup = new Error('plan_tier_key_already_exists');
      dup.statusCode = 409;
      throw dup;
    }
    throw e;
  }
}

async function listCommercialPlans({ limit, offset, includeInactive = true }) {
  const where = includeInactive ? {} : { isActive: true };
  return db.Plan.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: db.Organization,
        as: 'customOrganization',
        attributes: ['id', 'name', 'slug'],
        required: false,
      },
    ],
  });
}

async function getCommercialPlanById(planId) {
  const id = String(planId || '').trim();
  if (!UUID_RE.test(id)) {
    const err = new Error('plan_id_invalid');
    err.statusCode = 400;
    throw err;
  }
  const plan = await db.Plan.findByPk(id, {
    include: [
      {
        model: db.Organization,
        as: 'customOrganization',
        attributes: ['id', 'name', 'slug'],
        required: false,
      },
    ],
  });
  if (!plan) {
    const err = new Error('plan_not_found');
    err.statusCode = 404;
    throw err;
  }
  return plan.get({ plain: true });
}

/**
 * Atualiza plano comercial (tier_key imutável).
 * @param {string} planId
 * @param {Record<string, unknown>} payload
 */
async function updateCommercialPlan(planId, payload) {
  const plan = await db.Plan.findByPk(String(planId || '').trim());
  if (!plan) {
    const err = new Error('plan_not_found');
    err.statusCode = 404;
    throw err;
  }

  const body = payload && typeof payload === 'object' ? payload : {};
  /** @type {Record<string, unknown>} */
  const patch = {};

  if (body.name != null || body.displayName != null) {
    const name = String(body.name ?? body.displayName ?? '').trim();
    if (!name) {
      const err = new Error('plan_name_required');
      err.statusCode = 400;
      throw err;
    }
    patch.displayName = name;
  }

  if (body.stripe_price_id != null || body.stripePriceId != null) {
    const stripePriceId = String(body.stripe_price_id ?? body.stripePriceId ?? '').trim();
    if (!stripePriceId) {
      const err = new Error('plan_stripe_price_id_required');
      err.statusCode = 400;
      throw err;
    }
    patch.stripePriceId = stripePriceId;
  }

  if (body.limits != null) {
    const limitsRaw = body.limits;
    if (typeof limitsRaw !== 'object' || Array.isArray(limitsRaw)) {
      const err = new Error('plan_limits_must_be_object');
      err.statusCode = 400;
      throw err;
    }
    patch.limits = limitsRaw;
  }

  if (body.trial_days != null || body.trialDays != null) {
    const td = Number(body.trial_days ?? body.trialDays);
    patch.trialDays = Number.isFinite(td)
      ? Math.min(Math.max(Math.floor(td), 0), 730)
      : 0;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_public') || Object.prototype.hasOwnProperty.call(body, 'isPublic')) {
    patch.isPublic = readIsPublic(body);
  }

  if (
    Object.prototype.hasOwnProperty.call(body, 'custom_organization_id') ||
    Object.prototype.hasOwnProperty.call(body, 'customOrganizationId')
  ) {
    const rawCustom =
      body.custom_organization_id != null ? body.custom_organization_id : body.customOrganizationId;
    if (rawCustom == null || String(rawCustom).trim() === '') {
      patch.customOrganizationId = null;
    } else {
      const customOrganizationId = String(rawCustom).trim();
      if (!UUID_RE.test(customOrganizationId)) {
        const err = new Error('custom_organization_id_invalid');
        err.statusCode = 400;
        throw err;
      }
      const orgExists = await db.Organization.findByPk(customOrganizationId, { attributes: ['id'] });
      if (!orgExists) {
        const err = new Error('custom_organization_not_found');
        err.statusCode = 400;
        throw err;
      }
      patch.customOrganizationId = customOrganizationId;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'is_active') || Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    const raw = body.is_active != null ? body.is_active : body.isActive;
    patch.isActive = coerceBool(raw);
  }

  if (Object.keys(patch).length === 0) {
    const err = new Error('plan_patch_empty');
    err.statusCode = 400;
    throw err;
  }

  await plan.update(patch);
  return plan.get({ plain: true });
}

/** Desactiva plano (soft delete) — mantém histórico de assinaturas. */
async function deactivateCommercialPlan(planId) {
  const plan = await db.Plan.findByPk(String(planId || '').trim());
  if (!plan) {
    const err = new Error('plan_not_found');
    err.statusCode = 404;
    throw err;
  }
  await plan.update({ isActive: false, isPublic: false });
  return plan.get({ plain: true });
}

module.exports = {
  listSubscriptions,
  listInvoices,
  aggregatesForDashboard,
  createCommercialPlan,
  listCommercialPlans,
  getCommercialPlanById,
  updateCommercialPlan,
  deactivateCommercialPlan,
};
