'use strict';

const { DataTypes } = require('sequelize');

/** Copy/CTA do Meta AdCreative + JSON bruto para parsing futuro / auditoria IA. */

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn('ads', 'primary_text', {
      type: DataTypes.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('ads', 'headline', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await queryInterface.addColumn('ads', 'cta_type', {
      type: DataTypes.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn('ads', 'is_dynamic_creative', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('ads', 'raw_creative_data', {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ads', 'raw_creative_data').catch(() => {});
    await queryInterface.removeColumn('ads', 'is_dynamic_creative').catch(() => {});
    await queryInterface.removeColumn('ads', 'cta_type').catch(() => {});
    await queryInterface.removeColumn('ads', 'headline').catch(() => {});
    await queryInterface.removeColumn('ads', 'primary_text').catch(() => {});
  },
};
