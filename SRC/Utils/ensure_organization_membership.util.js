'use strict';

/**
 * Garante que `organizationId` está nas memberships do JWT (`req.user`), com status ativo ou indefinido.
 * @param {import('express').Request} req
 * @param {string} organizationId
 */
function ensureActiveJwtMembership(req, organizationId) {
  const oid = String(organizationId);
  const memberships = req.user?.memberships || [];
  const ok = memberships.some(
    (m) =>
      m.organizationId === oid &&
      (m.status === 'active' || m.status === null || m.status === undefined),
  );
  if (!ok) {
    const err = new Error('organization_not_in_membership');
    err.statusCode = 403;
    throw err;
  }
}

module.exports = { ensureActiveJwtMembership };
