'use strict';

const integrationConfig = require('../../../Services/integration_config.service');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function getIntegrations(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.integrations.get', {});
    const payload = await integrationConfig.getAdminIntegrationsView();
    res.json(payload);
  } catch (e) {
    next(e);
  }
}

async function putIntegrations(req, res, next) {
  try {
    const keys =
      req.body?.integrations && typeof req.body.integrations === 'object'
        ? Object.keys(req.body.integrations)
        : Object.keys(req.body || {});
    adminAudit(req.user?.userId, 'admin.integrations.put', { keys });
    const payload = await integrationConfig.upsertIntegrationsFromBody(req.body);
    res.json(payload);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getIntegrations,
  putIntegrations,
};
