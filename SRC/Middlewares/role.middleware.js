'use strict';

/**
 * Middleware de papel baseado nos `roles` presentes no JWT
 * (já devem cobrir membrosías ativas da sessão — ver `Auth/auth.service`).
 *
 * `@param roleKey` chave esperada (`Role.key`). Painel SaaS usa por padrão `hooko_platform_admin`.
 */

function requireJwtRole(roleKey = process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin') {
  return function roleMiddleware(req, _res, next) {
    const roles = req.user?.roles || [];
    if (!Array.isArray(roles) || !roles.includes(roleKey)) {
      const err = new Error('forbidden_missing_role');
      err.statusCode = 403;
      return next(err);
    }
    return next();
  };
}

module.exports = {
  requireJwtRole,
};
