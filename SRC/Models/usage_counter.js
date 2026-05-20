'use strict';

const { Model } = require('sequelize');

/** Contadores de uso enxutos para enforcement de quotas (ex.: creatives analisados / mês). */
module.exports = (sequelize, DataTypes) => {
  class UsageCounter extends Model {
    static associate(models) {
      UsageCounter.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    }
  }

  UsageCounter.init(
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
      metricKey: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      periodLabel: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      value: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: 'UsageCounter',
      tableName: 'usage_counters',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organizationId', 'metricKey', 'periodLabel'],
          name: 'usage_counters_org_metric_period_uidx',
        },
      ],
    },
  );

  return UsageCounter;
};
