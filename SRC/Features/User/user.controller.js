'use strict';

const userService = require('./user.service');

function scopedOrganizationIdsFromJwt(req) {
  const memberships = req.user?.memberships || [];
  return [
    ...new Set(
      memberships
        .filter((m) => m.status === 'active' || m.status === null || m.status === undefined)
        .map((m) => m.organizationId)
        .filter(Boolean),
    ),
  ];
}

/**
 * Thin HTTP layer para User — lista apenas colegas de tenant(s) do JWT.
 */
async function listUsers(req, res, next) {
  try {
    const orgIds = scopedOrganizationIdsFromJwt(req);
    if (!orgIds.length) {
      return res.json([]);
    }
    const users = await userService.listUsersInOrganizations(orgIds);
    res.json(users);
  } catch (error) {
    next(error);
  }
}

async function healthSanity(req, res, next) {
  try {
    const orgIds = scopedOrganizationIdsFromJwt(req);
    const totalUsers = orgIds.length
      ? await userService.countUsersInOrganizations(orgIds)
      : 0;
    res.json({ ok: true, totalUsers, scopeOrganizationCount: orgIds.length });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listUsers,
  healthSanity,
};
