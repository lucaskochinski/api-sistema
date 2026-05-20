'use strict';

const organizationsService = require('../services/admin.organizations.service');
const { coercePagination, coerceSearch } = require('../helpers/coerceBody.util');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function list(req, res, next) {
  try {
    const { limit, offset } = coercePagination(req.query);
    const search = coerceSearch(req.query);
    adminAudit(req.user?.userId, 'admin.organizations.list', { limit, offset, search });
    const { rows, count } = await organizationsService.listOrganizations({ limit, offset, search });
    res.json({ total: count, limit, offset, items: rows });
  } catch (e) {
    next(e);
  }
}

async function getById(req, res, next) {
  try {
    const { organizationId } = req.params;
    adminAudit(req.user?.userId, 'admin.organizations.get', { organizationId });
    const org = await organizationsService.getOrganizationById(organizationId);
    if (!org) {
      const err = new Error('organization_not_found');
      err.statusCode = 404;
      return next(err);
    }
    res.json(org);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  getById,
};
