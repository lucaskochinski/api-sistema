'use strict';

const bcrypt = require('bcryptjs');
const db = require('./Models');

const BCRYPT_COST = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

const ADMIN_EMAIL = String(
  process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@admin.com',
)
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD =
  process.env.SEED_SUPER_ADMIN_PASSWORD || 'admin123';

const HOOKO_ADMIN_ORG_SLUG =
  process.env.SEED_SUPER_ADMIN_ORG_SLUG || 'hooko-admin';

const HOOKO_ADMIN_ORG_NAME =
  process.env.SEED_SUPER_ADMIN_ORG_NAME || 'HOOKO Admin';

const PLATFORM_ROLE_KEY =
  process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin';

/**
 * Garante operador inicial + org central + Super Admin (`hooko_platform_admin`) — idempotente.
 */
async function bootstrapDatabase() {
  // Auto-seeda as roles necessárias para o sistema funcionar caso não existam
  const [platformRole] = await db.Role.findOrCreate({
    where: { key: PLATFORM_ROLE_KEY },
    defaults: {
      id: 'a0000004-7000-4000-a000-000000000003',
      key: PLATFORM_ROLE_KEY,
      name: 'Administrador da plataforma HOOKO',
    },
  });

  await db.Role.findOrCreate({
    where: { key: 'admin' },
    defaults: {
      id: 'a0000004-7000-4000-a000-000000000002',
      key: 'admin',
      name: 'Administrador da organização',
    },
  });

  const [u, createdUser] = await db.User.scope(null).findOrCreate({
    where: { email: ADMIN_EMAIL },
    defaults: {
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(String(ADMIN_PASSWORD), BCRYPT_COST),
    },
  });

  const pwdOk = String(ADMIN_PASSWORD || '').length >= 8;
  const needsPasswordBootstrap = pwdOk && (createdUser || !u.passwordHash);
  if (needsPasswordBootstrap) {
    await u.update({
      passwordHash: await bcrypt.hash(String(ADMIN_PASSWORD), BCRYPT_COST),
    });
  }

  const [orgInst] = await db.Organization.findOrCreate({
    where: { slug: HOOKO_ADMIN_ORG_SLUG },
    defaults: {
      name: HOOKO_ADMIN_ORG_NAME,
      slug: HOOKO_ADMIN_ORG_SLUG,
    },
  });

  const [mShip, createdMem] = await db.Membership.findOrCreate({
    where: { organizationId: orgInst.id, userId: u.id },
    defaults: {
      organizationId: orgInst.id,
      userId: u.id,
      status: 'active',
    },
  });
  await mShip.update({ status: 'active' }).catch(() => {});
  void createdMem;

  await db.MembershipRole.findOrCreate({
    where: {
      membershipId: mShip.id,
      roleId: platformRole.id,
    },
    defaults: {
      membershipId: mShip.id,
      roleId: platformRole.id,
    },
  });

  try {
    await db.SystemSetting.findOrCreate({
      where: { key: 'DAILY_SYNC_TIME' },
      defaults: {
        key: 'DAILY_SYNC_TIME',
        value: { time: '02:30' },
      },
    });
  } catch (_e) {
    console.warn(
      '[bootstrapDatabase] system_settings inexistente ainda — rode `npm run migrate`.',
    );
  }

  console.info('[bootstrapDatabase] ok', {
    email: ADMIN_EMAIL,
    org: HOOKO_ADMIN_ORG_SLUG,
  });
}

module.exports = { bootstrapDatabase };
