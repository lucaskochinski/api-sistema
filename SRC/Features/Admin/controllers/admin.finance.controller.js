'use strict';

const financeService = require('../services/admin.finance.service');
const { coercePagination } = require('../helpers/coerceBody.util');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function listSubscriptions(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.finance.list_subscriptions', coercePagination(req.query));
    const { limit, offset } = coercePagination(req.query);
    const { rows, count } = await financeService.listSubscriptions({ limit, offset });
    res.json({ total: count, limit, offset, items: rows });
  } catch (e) {
    next(e);
  }
}

async function listInvoices(req, res, next) {
  try {
    const { limit, offset } = coercePagination(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    adminAudit(req.user?.userId, 'admin.finance.list_invoices', { limit, offset, status });
    const { rows, count } = await financeService.listInvoices({ limit, offset, status });
    res.json({ total: count, limit, offset, items: rows });
  } catch (e) {
    next(e);
  }
}

async function financeSummary(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.finance.summary', {});
    const summary = await financeService.aggregatesForDashboard();
    res.json(summary);
  } catch (e) {
    next(e);
  }
}

async function createPlan(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.finance.plan_create', {
      tier_key: req.body?.tier_key,
      is_public: req.body?.is_public ?? req.body?.isPublic,
      custom_organization_id: req.body?.custom_organization_id ?? req.body?.customOrganizationId,
    });
    const plan = await financeService.createCommercialPlan(req.body || {});
    res.status(201).json(plan);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listSubscriptions,
  listInvoices,
  financeSummary,
  createPlan,
};
