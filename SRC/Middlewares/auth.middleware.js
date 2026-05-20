'use strict';

const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../Features/Auth/auth.service');

/** Autentica `Authorization: Bearer <JWT>` e anexa `req.user`. */
async function authMiddleware(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [kind, raw] = String(header).split(/\s+/);
    if (!raw || kind.toLowerCase() !== 'bearer') {
      const err = new Error('authorization_bearer_missing');
      err.statusCode = 401;
      return next(err);
    }

    /** @type {object} */
    const decoded = jwt.verify(raw, jwtSecret());

    req.user = {
      userId: decoded.sub,
      email: decoded.email,
      roles: Array.isArray(decoded.roles) ? decoded.roles : [],
      memberships: Array.isArray(decoded.memberships) ? decoded.memberships : [],
    };

    return next();
  } catch (_e) {
    const err = new Error('invalid_or_expired_token');
    err.statusCode = 401;
    return next(err);
  }
}

module.exports = authMiddleware;
