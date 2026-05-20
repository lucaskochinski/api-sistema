'use strict';

/** Planos públicos (landing) vs exclusivos por tenant (`custom_organization_id`). */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('plans', 'is_public', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.addColumn('plans', 'custom_organization_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'organizations',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('plans', ['custom_organization_id'], {
      name: 'plans_custom_organization_id_idx',
    });

    await queryInterface.addIndex('plans', ['is_active', 'is_public'], {
      name: 'plans_active_public_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('plans', 'plans_active_public_idx');
    await queryInterface.removeIndex('plans', 'plans_custom_organization_id_idx');
    await queryInterface.removeColumn('plans', 'custom_organization_id');
    await queryInterface.removeColumn('plans', 'is_public');
  },
};
