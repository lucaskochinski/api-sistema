'use strict';

const usersService = require('../services/admin.users.service');
const { coercePagination, coerceSearch } = require('../helpers/coerceBody.util');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function list(req, res, next) {
  try {
    const { limit, offset } = coercePagination(req.query);
    const search = coerceSearch(req.query);
    adminAudit(req.user?.userId, 'admin.users.list', { limit, offset, search });
    const { rows, count } = await usersService.listUsers({ limit, offset, search });
    res.json({ total: count, limit, offset, items: rows });
  } catch (e) {
    next(e);
  }
}

async function getById(req, res, next) {
  try {
    const { userId } = req.params;
    adminAudit(req.user?.userId, 'admin.users.get', { targetUserId: userId });
    const userRecord = await usersService.getUserById(userId);
    if (!userRecord) {
      const err = new Error('user_not_found');
      err.statusCode = 404;
      return next(err);
    }
    res.json(userRecord);
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const { email, password, organizationId, roleKeys, membershipStatus } = req.body || {};
    adminAudit(req.user?.userId, 'admin.users.create', {
      targetEmail: email,
      organizationId,
    });
    const userRecord = await usersService.createManagedUser({
      email,
      password,
      organizationId,
      roleKeys,
      membershipStatus,
    });
    res.status(201).json(userRecord);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  getById,
  create,
};
