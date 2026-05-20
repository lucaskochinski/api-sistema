'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../Models');

const BCRYPT_COST = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

function platformAdminJwtRoleKey() {
  return process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || String(s).length < 16) throw new Error('JWT_SECRET_missing_or_weak');
  return String(s);
}

function bootstrapPlatformEmails() {
  const raw = process.env.HOOKO_PLATFORM_ADMIN_EMAILS || '';
  return raw
    .split(/[,;\s]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

async function slugifyUniqueBase(name, transaction) {
  const baseRaw = String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  const base = baseRaw.length ? baseRaw : 'organization';
  for (let i = 0; i < 8; i += 1) {
    const suffix = i === 0 ? '' : `-${Math.random().toString(36).slice(2, 8)}`;
    const candidate = `${base}${suffix}`.slice(0, 120);
    const exists = await db.Organization.findOne({
      where: { slug: candidate },
      attributes: ['id'],
      transaction,
    });
    if (!exists) return candidate;
  }
  throw new Error('could_not_resolve_unique_organization_slug');
}

function collectMembershipPayload(memberships) {
  const list = Array.isArray(memberships) ? memberships : [];
  return list.map((m) => ({
    organizationId: m.organizationId,
    membershipId: m.id,
    status: m.status,
  }));
}

function collectRoleKeysFromMembershipRows(memberships) {
  const keys = new Set();
  for (const m of memberships || []) {
    for (const r of m.roles || []) {
      if (r && r.key) keys.add(String(r.key));
    }
  }
  return [...keys];
}

async function enrichRolesWithPlatformBypass(email, roles) {
  const set = new Set(roles || []);
  if (bootstrapPlatformEmails().includes(normalizeEmail(email))) {
    set.add(platformAdminJwtRoleKey());
  }
  return [...set];
}

async function resolveUserCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    const err = new Error('credentials_required');
    err.statusCode = 400;
    throw err;
  }

  const user = await db.User.scope(null).findOne({
    where: { email: normalizedEmail },
    include: [
      {
        model: db.Membership,
        as: 'memberships',
        /** active + invite allow login? strictly active only */
        where: { status: 'active' },
        required: false,
        include: [
          {
            model: db.Role,
            as: 'roles',
            required: false,
            through: { attributes: [] },
          },
        ],
      },
    ],
  });

  if (!user || !user.passwordHash) {
    const err = new Error('invalid_credentials');
    err.statusCode = 401;
    throw err;
  }

  const match = await bcrypt.compare(String(password), user.passwordHash);
  if (!match) {
    const err = new Error('invalid_credentials');
    err.statusCode = 401;
    throw err;
  }

  const memberships = collectMembershipPayload(user.memberships || []);
  const roleKeysRaw = collectRoleKeysFromMembershipRows(user.memberships || []);
  const roles = await enrichRolesWithPlatformBypass(user.email, roleKeysRaw);

  return { userId: user.id, email: user.email, memberships, roles };
}

function signAuthToken(profile) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(
    {
      sub: profile.userId,
      email: profile.email,
      roles: profile.roles,
      memberships: profile.memberships,
    },
    jwtSecret(),
    { expiresIn },
  );
}

async function login({ email, password }) {
  const profile = await resolveUserCredentials(email, password);
  const accessToken = signAuthToken(profile);
  return {
    accessToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    user: {
      id: profile.userId,
      email: profile.email,
      roles: profile.roles,
      memberships: profile.memberships,
    },
  };
}

async function register({ organizationName, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const orgTitle = String(organizationName || '').trim();

  if (!orgTitle.length || normalizedEmail.length < 3 || !password || String(password).length < 8) {
    const err = new Error('register_validation_failed');
    err.statusCode = 400;
    throw err;
  }

  let result;
  try {
    await db.sequelize.transaction(async (transaction) => {
      const slug = await slugifyUniqueBase(orgTitle, transaction);

      const adminRole = await db.Role.findOne({
        where: { key: 'admin' },
        transaction,
      });
      if (!adminRole) {
        throw new Error('bootstrap_role_admin_missing_run_migrations');
      }

      const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);

      const organization = await db.Organization.create(
        {
          name: orgTitle,
          slug,
        },
        { transaction },
      );

      let user = await db.User.scope(null).findOne({
        where: { email: normalizedEmail },
        transaction,
      });
      if (user) {
        const dup = new Error('email_already_registered');
        dup.statusCode = 409;
        throw dup;
      }

      user = await db.User.create(
        {
          email: normalizedEmail,
          passwordHash,
        },
        { transaction },
      );

      const membership = await db.Membership.create(
        {
          organizationId: organization.id,
          userId: user.id,
          status: 'active',
        },
        { transaction },
      );

      await db.MembershipRole.create(
        {
          membershipId: membership.id,
          roleId: adminRole.id,
        },
        { transaction },
      );

      const memberships = collectMembershipPayload([membership]);
      const roles = await enrichRolesWithPlatformBypass(user.email, ['admin']);

      result = {
        userId: user.id,
        email: user.email,
        organizationId: organization.id,
        membershipId: membership.id,
        memberships,
        roles,
        accessToken: signAuthToken({ userId: user.id, email: user.email, memberships, roles }),
      };
    });
  } catch (e) {
    if (
      e?.name === 'SequelizeUniqueConstraintError' &&
      Array.isArray(e.errors) &&
      e.errors.some((x) => /email/i.test(x.path || x.message || ''))
    ) {
      const conflict = new Error('email_already_registered');
      conflict.statusCode = 409;
      throw conflict;
    }
    if (typeof e.message === 'string' && e.message.includes('bootstrap_role_admin')) {
      const err = new Error('server_misconfiguration_roles');
      err.statusCode = 500;
      throw err;
    }
    throw e;
  }

  return {
    accessToken: result.accessToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    user: {
      id: result.userId,
      email: result.email,
      roles: result.roles,
      memberships: result.memberships,
    },
    organizationId: result.organizationId,
    membershipId: result.membershipId,
  };
}

/** Perfil público além do JWT (sem password). */
async function getMeProfile(userId) {
  const user = await db.User.findByPk(userId, {
    include: [
      {
        model: db.Membership,
        as: 'memberships',
        where: { status: 'active' },
        required: false,
        include: [
          {
            model: db.Role,
            as: 'roles',
            required: false,
            through: { attributes: [] },
          },
          {
            model: db.Organization,
            as: 'organization',
            attributes: ['id', 'name', 'slug'],
            required: false,
          },
        ],
      },
    ],
  });

  if (!user) {
    const err = new Error('user_not_found');
    err.statusCode = 404;
    throw err;
  }

  const memberships = collectMembershipPayload(user.memberships || []);
  const roleKeysRaw = collectRoleKeysFromMembershipRows(user.memberships || []);
  const roles = await enrichRolesWithPlatformBypass(user.email, roleKeysRaw);

  return {
    id: user.id,
    email: user.email,
    roles,
    membershipsDetailed: user.memberships || [],
    membershipsLean: memberships,
  };
}

module.exports = {
  jwtSecret,
  login,
  register,
  getMeProfile,
};
