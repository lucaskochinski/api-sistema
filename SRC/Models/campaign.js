'use strict';

const { Model } = require('sequelize');

/** Meta Campaign anchored to Marketing API hierarchy */
module.exports = (sequelize, DataTypes) => {
  class Campaign extends Model {
    static associate(models) {
      Campaign.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
      Campaign.belongsTo(models.MetaAdAccount, {
        foreignKey: 'metaAdAccountId',
        as: 'metaAdAccount',
      });
      Campaign.hasMany(models.AdSet, { foreignKey: 'campaignId', as: 'adSets' });
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
          fields: ['metaAdAccountId', 'metaCampaignId'],
          name: 'campaigns_account_campaign_uidx',
        },
        { fields: ['organizationId'], name: 'campaigns_organization_id_idx' },
      ],
    },
  );

  return Campaign;
};
