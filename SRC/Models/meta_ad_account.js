'use strict';

const { Model } = require('sequelize');

/**
 * Meta Ad Account synced from Marketing API ("act_xxxxx").
 */
module.exports = (sequelize, DataTypes) => {
  class MetaAdAccount extends Model {
    static associate(models) {
      MetaAdAccount.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
      MetaAdAccount.hasMany(models.Campaign, { foreignKey: 'metaAdAccountId', as: 'campaigns' });
    }
  }

  MetaAdAccount.init(
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
      metaActId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'MetaAdAccount',
      tableName: 'meta_ad_accounts',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organizationId', 'metaActId'],
          name: 'meta_ad_accounts_organization_act_uidx',
        },
      ],
    },
  );

  return MetaAdAccount;
};
