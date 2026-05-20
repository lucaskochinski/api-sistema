'use strict';

const { Model } = require('sequelize');

/**
 * Fatia diária de métricas (time-series compacta por Ad + Organization).
 * Coluna `metrics_jsonb` permite evoluir o schema Meta sem DDL frequente.
 */
module.exports = (sequelize, DataTypes) => {
  class AdPerformanceDaily extends Model {
    static associate(models) {
      AdPerformanceDaily.belongsTo(models.Organization, {
        foreignKey: 'organization_id',
        as: 'organization',
      });
      AdPerformanceDaily.belongsTo(models.Ad, { foreignKey: 'ad_id', as: 'ad' });
    }
  }

  AdPerformanceDaily.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      adId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /** Dimensão temporal agregada (UTC date bucket) */
      snapshotDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      metricsJsonb: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'metrics_jsonb',
      },
      impressions: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      clicks: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      spend: {
        type: DataTypes.DECIMAL(18, 6),
        allowNull: true,
      },
      ctr: {
        type: DataTypes.DECIMAL(18, 8),
        allowNull: true,
      },
      roas: {
        type: DataTypes.DECIMAL(18, 8),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AdPerformanceDaily',
      tableName: 'ad_performance_daily',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organization_id', 'ad_id', 'snapshot_date'],
          name: 'ad_performance_daily_org_ad_day_uidx',
        },
        { fields: ['organization_id'], name: 'ad_performance_daily_organization_idx' },
        { fields: ['snapshot_date'], name: 'ad_performance_daily_snapshot_date_idx' },
      ],
    },
  );

  return AdPerformanceDaily;
};
