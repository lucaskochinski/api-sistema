'use strict';

const authService = require('./auth.service');

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const body = await authService.login({ email, password });
    res.json(body);
  } catch (error) {
    next(error);
  }
}

async function register(req, res, next) {
  try {
    const { email, password, organizationName } = req.body || {};
    const body = await authService.register({ email, password, organizationName });
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const profile = await authService.getMeProfile(req.user.userId);
    res.json({
      id: profile.id,
      email: profile.email,
      roles: profile.roles,
      memberships: profile.membershipsLean,
      organizationsByMembership:
        profile.membershipsDetailed?.map((m) => ({
          membershipId: m.id,
          organizationId: m.organizationId,
          organization: m.organization,
          roles: (m.roles || []).map((r) => ({ key: r.key, name: r.name })),
        })) || [],
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  register,
  me,
};
