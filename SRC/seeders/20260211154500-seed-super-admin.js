'use strict';

const bcrypt = require('bcryptjs');

/** IDs estáveis quando o usuário/org são criados por este seed. */
const IDS = {
  user: 'b0000005-9000-5000-a000-000000000001',
  organization: 'c0000005-9000-5000-a000-000000000001',
  membership: 'd0000005-9000-5000-a000-000000000001',
};

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_ORG_SLUG = 'hooko-admin';
const ADMIN_ORG_NAME = 'HOOKO Admin';

const BCRYPT_COST = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [roles] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE key = :key LIMIT 1`,
      { replacements: { key: 'hooko_platform_admin' } },
    );
    if (!roles?.[0]?.id) {
      throw new Error(
        'bootstrap_role_hooko_platform_admin_missing_run_migrations_first',
      );
    }
    const platformRoleId = roles[0].id;

    const [existingUsers] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE lower(email) = lower(:email) LIMIT 1`,
      { replacements: { email: ADMIN_EMAIL } },
    );

    /** Seeder idempotente: não recria usuário já presente */
    let userId = existingUsers?.[0]?.id ? String(existingUsers[0].id) : IDS.user;

    if (!existingUsers?.[0]) {
      const passwordHash = await bcrypt.hash(String(ADMIN_PASSWORD), BCRYPT_COST);
      await queryInterface.bulkInsert(
        'users',
        [
          {
            id: userId,
            email: ADMIN_EMAIL,
            password_hash: passwordHash,
            auth_provider_subject: null,
            created_at: now,
            updated_at: now,
          },
        ],
        {},
      );
    }

    const [existingOrgs] = await queryInterface.sequelize.query(
      `SELECT id FROM organizations WHERE slug = :slug LIMIT 1`,
      { replacements: { slug: ADMIN_ORG_SLUG } },
    );
    let orgId = existingOrgs?.[0]?.id ? String(existingOrgs[0].id) : IDS.organization;

    if (!existingOrgs?.[0]) {
      await queryInterface.bulkInsert(
        'organizations',
        [
          {
            id: orgId,
            name: ADMIN_ORG_NAME,
            slug: ADMIN_ORG_SLUG,
            stripe_customer_id: null,
            created_at: now,
            updated_at: now,
          },
        ],
        {},
      );
    }

    const [existingMembershipRows] = await queryInterface.sequelize.query(
      `SELECT id FROM memberships WHERE organization_id::text = :oid AND user_id::text = :uid LIMIT 1`,
      { replacements: { oid: String(orgId), uid: String(userId) } },
    );
    let membershipId = existingMembershipRows?.[0]?.id
      ? String(existingMembershipRows[0].id)
      : IDS.membership;

    if (!existingMembershipRows?.[0]) {
      await queryInterface.bulkInsert(
        'memberships',
        [
          {
            id: membershipId,
            organization_id: orgId,
            user_id: userId,
            status: 'active',
            created_at: now,
            updated_at: now,
          },
        ],
        {},
      );
    }

    /** Vínculo do papel hooko_platform_admin (ignora duplicata) */
    await queryInterface.sequelize.query(
      `
      INSERT INTO membership_roles (membership_id, role_id)
      SELECT CAST(:membership_id AS uuid), CAST(:role_id AS uuid)
      WHERE NOT EXISTS (
        SELECT 1 FROM membership_roles
        WHERE membership_id::text = :membership_id AND role_id::text = :role_id
      );
    `,
      {
        replacements: {
          membership_id: String(membershipId),
          role_id: String(platformRoleId),
        },
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM membership_roles USING memberships m, organizations o, users u
      WHERE membership_roles.membership_id = m.id
        AND m.organization_id = o.id AND o.slug = :slug
        AND m.user_id = u.id AND lower(u.email) = lower(:email);
    `,
      { replacements: { slug: ADMIN_ORG_SLUG, email: ADMIN_EMAIL } },
    );

    await queryInterface.sequelize.query(`
      DELETE FROM memberships USING organizations o, users u
      WHERE memberships.organization_id = o.id AND o.slug = :slug
        AND memberships.user_id = u.id AND lower(u.email) = lower(:email);
    `,
      { replacements: { slug: ADMIN_ORG_SLUG, email: ADMIN_EMAIL } },
    );

    await queryInterface.sequelize.query(
      `DELETE FROM users WHERE lower(email) = lower(:email)`,
      { replacements: { email: ADMIN_EMAIL } },
    );

    await queryInterface.sequelize.query(
      `DELETE FROM organizations WHERE slug = :slug`,
      { replacements: { slug: ADMIN_ORG_SLUG } },
    );
  },
};
