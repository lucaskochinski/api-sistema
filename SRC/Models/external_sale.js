'use strict';

const { Model } = require('sequelize');

/**
 * Registro de vendas externas recebidas via Webhooks (Utmify, Pagtrust, Lovable, Hooko, Vturb).
 */
module.exports = (sequelize, DataTypes) => {
  class ExternalSale extends Model {
    static associate(models) {
      ExternalSale.belongsTo(models.Organization, {
        foreignKey: 'organizationId',
        as: 'organization',
        onDelete: 'CASCADE',
      });
    }
  }

  ExternalSale.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: true, // Pode ser associado posteriormente se resolvido por UTM
      },
      platform: {
        type: DataTypes.ENUM('utmify', 'pagtrust', 'lovable', 'hooko', 'vturb'),
        allowNull: false,
      },
      transactionId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      paymentMethod: {
        type: DataTypes.ENUM('pix', 'credit_card', 'billet', 'other'),
        allowNull: false,
        defaultValue: 'other',
      },
      utmTerm: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      utmSource: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      utmCampaign: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      saleDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'ExternalSale',
      tableName: 'external_sales',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['platform', 'transaction_id'],
          name: 'external_sales_platform_txn_uidx',
        },
        {
          fields: ['organization_id'],
          name: 'external_sales_organization_idx',
        },
        {
          fields: ['utm_term'],
          name: 'external_sales_utm_term_idx',
        },
      ],
    },
  );

  return ExternalSale;
};
