'use strict';

const { Model } = require('sequelize');

/**
 * Linhas materializadas de tentativas/liquidações (Charge/PaymentIntent) para consultas rápidas
 * de timeline sem varrer payloads JSON brutos inteiros. Complementam `WebhookEventLog`.
 */
module.exports = (sequelize, DataTypes) => {
  class PaymentTransaction extends Model {
    static associate(models) {
      PaymentTransaction.belongsTo(models.Organization, {
        foreignKey: 'organization_id',
        as: 'organization',
      });
      PaymentTransaction.belongsTo(models.Subscription, {
        foreignKey: 'subscription_id',
        as: 'subscription',
      });
      PaymentTransaction.belongsTo(models.Invoice, { foreignKey: 'invoice_id', as: 'invoice' });
      PaymentTransaction.belongsTo(models.WebhookEventLog, {
        foreignKey: 'webhookEventLogId',
        as: 'webhookEventLog',
      });
    }
  }

  PaymentTransaction.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      subscriptionId: { type: DataTypes.UUID, allowNull: true },
      invoiceId: { type: DataTypes.UUID, allowNull: true },
      webhookEventLogId: { type: DataTypes.UUID, allowNull: true },
      gateway: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'stripe',
      },
      gatewayObjectId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      objectType: { type: DataTypes.STRING(48), allowNull: false },
      status: { type: DataTypes.STRING(48), allowNull: false },
      amountCents: { type: DataTypes.BIGINT, allowNull: true },
      currency: { type: DataTypes.STRING(3), allowNull: true },
      failureCode: { type: DataTypes.STRING(128), allowNull: true },
      failureMessage: { type: DataTypes.TEXT, allowNull: true },
      gatewayBalanceTransactionId: { type: DataTypes.STRING(128), allowNull: true },
      occurredAt: { type: DataTypes.DATE, allowNull: true },
      rawSummary: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'PaymentTransaction',
      tableName: 'payment_transactions',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['gateway', 'gateway_object_id'],
          name: 'payment_transactions_gateway_object_uidx',
        },
        { fields: ['organization_id'], name: 'payment_transactions_organization_id_idx' },
        { fields: ['invoice_id'], name: 'payment_transactions_invoice_id_idx' },
        { fields: ['subscription_id'], name: 'payment_transactions_subscription_id_idx' },
        { fields: ['occurred_at'], name: 'payment_transactions_occurred_at_idx' },
      ],
    },
  );

  return PaymentTransaction;
};
