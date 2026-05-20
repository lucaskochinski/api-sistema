'use strict';

/** Config global admin + dias de trial em `plans`. */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // 1. Verificar se a tabela 'system_settings' já existe
    const tableExists = await queryInterface.describeTable('system_settings')
      .then(() => true)
      .catch(() => false);

    if (!tableExists) {
      await queryInterface.createTable('system_settings', {
        id: {
          type: DataTypes.UUID,
          primaryKey: true,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
        },
        key: {
          type: DataTypes.STRING(128),
          allowNull: false,
        },
        value: {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: Sequelize.literal("'{}'::jsonb"),
        },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });

      // Adicionar o índice apenas se a tabela acabou de ser criada para evitar conflito de indexação
      await queryInterface.addIndex('system_settings', ['key'], {
        unique: true,
        name: 'system_settings_key_uidx',
      }).catch(() => {});
    }

    // 2. Verificar se a coluna 'trial_days' já existe na tabela 'plans'
    const plansTableInfo = await queryInterface.describeTable('plans').catch(() => ({}));
    if (!plansTableInfo.trial_days) {
      await queryInterface.addColumn('plans', 'trial_days', {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeColumn('plans', 'trial_days');
    } catch (_) {}
    try {
      await queryInterface.dropTable('system_settings');
    } catch (_) {}
  },
};
