'use strict';

const metricsService = require('../services/admin.metrics.service');
const { coercePagination } = require('../helpers/coerceBody.util');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function overview(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.metrics.overview', {});
    const overviewStats = await metricsService.getPlatformOverview();
    res.json(overviewStats);
  } catch (e) {
    next(e);
  }
}

async function webhookHealth(req, res, next) {
  try {
    const page = coercePagination(req.query);
    adminAudit(req.user?.userId, 'admin.metrics.webhooks', page);
    const snapshot = await metricsService.webhookHealthSnapshot({ limit: page.limit });
    res.json(snapshot);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  overview,
  webhookHealth,
};
