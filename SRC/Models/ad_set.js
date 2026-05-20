'use strict';

const { Model } = require('sequelize');

/** Meta Ad Set under a Campaign within an Organization */
module.exports = (sequelize, DataTypes) => {
  class AdSet extends Model {
    static associate(models) {
      AdSet.belongsTo(models.Organization, { foreignKey: 'organization_id', as: 'organization' });
      AdSet.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
      AdSet.hasMany(models.Ad, { foreignKey: 'ad_set_id', as: 'ads' });
    }
  }

  AdSet.init(
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
      campaignId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      metaAdsetId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AdSet',
      tableName: 'ad_sets',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organization_id', 'meta_adset_id'],
          name: 'ad_sets_organization_adset_uidx',
        },
        { fields: ['campaign_id'], name: 'ad_sets_campaign_id_idx' },
      ],
    },
  );

  return AdSet;
};
