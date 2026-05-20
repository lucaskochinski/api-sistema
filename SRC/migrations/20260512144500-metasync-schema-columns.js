'use strict';

const { DataTypes } = require('sequelize');

/** MetaSync: vídeo/creative em ads + colunas rápidas de insights em `ad_performance_daily`. */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ads', 'meta_creative_id', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('ads', 'meta_video_id', {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('ads', ['meta_video_id'], {
      name: 'ads_meta_video_id_idx',
    });

    await queryInterface.addColumn('ad_performance_daily', 'impressions', {
      type: DataTypes.BIGINT,
      allowNull: true,
    });
    await queryInterface.addColumn('ad_performance_daily', 'clicks', {
      type: DataTypes.BIGINT,
      allowNull: true,
    });
    await queryInterface.addColumn('ad_performance_daily', 'spend', {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: true,
    });
    await queryInterface.addColumn('ad_performance_daily', 'ctr', {
      type: DataTypes.DECIMAL(18, 8),
      allowNull: true,
    });
    await queryInterface.addColumn('ad_performance_daily', 'roas', {
      type: DataTypes.DECIMAL(18, 8),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('ads', 'ads_meta_video_id_idx').catch(() => {});
    await queryInterface.removeColumn('ads', 'meta_creative_id').catch(() => {});
    await queryInterface.removeColumn('ads', 'meta_video_id').catch(() => {});
    await queryInterface.removeColumn('ad_performance_daily', 'roas').catch(() => {});
    await queryInterface.removeColumn('ad_performance_daily', 'ctr').catch(() => {});
    await queryInterface.removeColumn('ad_performance_daily', 'spend').catch(() => {});
    await queryInterface.removeColumn('ad_performance_daily', 'clicks').catch(() => {});
    await queryInterface.removeColumn('ad_performance_daily', 'impressions').catch(() => {});
  },
};
