'use strict';

/**
 * Roles usadas pelo fluxo de registro (`admin` por organização)
 * e pelo painel SaaS (`hooko_platform_admin`, via RBAC ou e-mail em JWT).
 */

/** UUIDs estáveis facilitam dados de exemplo e troubleshooting. */
const ROLE_IDS = {
  admin: 'a0000004-7000-4000-a000-000000000002',
  hooko_platform_admin: 'a0000004-7000-4000-a000-000000000003',
};

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const rows = [
      {
        id: ROLE_IDS.admin,
        key: 'admin',
        name: 'Administrador da organização',
        created_at: now,
        updated_at: now,
      },
      {
        id: ROLE_IDS.hooko_platform_admin,
        key: 'hooko_platform_admin',
        name: 'Administrador da plataforma HOOKO',
        created_at: now,
        updated_at: now,
      },
    ];

    for (const row of rows) {
      await queryInterface.sequelize.query(
        `
        INSERT INTO roles (id, key, name, created_at, updated_at)
        SELECT :id, :key, :name, :created_at, :updated_at
        WHERE NOT EXISTS (SELECT 1 FROM roles WHERE key = :key);
      `,
        { replacements: row },
      );
    }
  },

  async down(queryInterface, Sequelize) {
    const Op = Sequelize.Op;
    await queryInterface.bulkDelete(
      'roles',
      {
        key: { [Op.in]: ['admin', 'hooko_platform_admin'] },
      },
      {},
    );
  },
};
