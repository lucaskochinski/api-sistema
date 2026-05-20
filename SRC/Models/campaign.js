'use strict';

const { Model } = require('sequelize');

/** Meta Campaign anchored to Marketing API hierarchy */
module.exports = (sequelize, DataTypes) => {
  class Campaign extends Model {
    static associate(models) {
      Campaign.belongsTo(models.Organization, { foreignKey: 'organization_id', as: 'organization' });
      Campaign.belongsTo(models.MetaAdAccount, {
        foreignKey: 'meta_ad_account_id',
        as: 'metaAdAccount',
      });
      Campaign.hasMany(models.AdSet, { foreignKey: 'campaign_id', as: 'adSets' });
    }
  }

  Campaign.init(
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
      metaAdAccountId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      metaCampaignId: {
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
      modelName: 'Campaign',
      tableName: 'campaigns',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['meta_ad_account_id', 'meta_campaign_id'],
          name: 'campaigns_account_campaign_uidx',
        },
        { fields: ['organization_id'], name: 'campaigns_organization_id_idx' },
      ],
    },
  );

  return Campaign;
};
