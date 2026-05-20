'use strict';

/** Config global admin + dias de trial em `plans`. */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

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

    await queryInterface.addIndex('system_settings', ['key'], {
      unique: true,
      name: 'system_settings_key_uidx',
    });

    await queryInterface.addColumn('plans', 'trial_days', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('plans', 'trial_days');
    await queryInterface.dropTable('system_settings');
  },
};
