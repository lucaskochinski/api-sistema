'use strict';

const { Model } = require('sequelize');

/**
 * Espelho de faturamento (Stripe Invoice e equivalentes futuros): histórico de cobrança,
 * status, tentativas e links hospedados. Complementa `subscriptions` sem substituí-la.
 */
module.exports = (sequelize, DataTypes) => {
  class Invoice extends Model {
    static associate(models) {
      Invoice.belongsTo(models.Organization, { foreignKey: 'organization_id', as: 'organization' });
      Invoice.belongsTo(models.Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
      Invoice.hasMany(models.PaymentTransaction, { foreignKey: 'invoiceId', as: 'paymentTransactions' });
    }
  }

  Invoice.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      subscriptionId: { type: DataTypes.UUID, allowNull: true },
      stripeInvoiceId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      stripeSubscriptionIdLegacy: { type: DataTypes.STRING(128), allowNull: true },
      stripeCustomerIdLegacy: { type: DataTypes.STRING(128), allowNull: true },
      invoiceNumber: { type: DataTypes.STRING(128), allowNull: true },
      status: { type: DataTypes.STRING(48), allowNull: false },
      billingReason: { type: DataTypes.STRING(48), allowNull: true },
      collectionMethod: { type: DataTypes.STRING(32), allowNull: true },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'usd',
      },
      amountDueCents: { type: DataTypes.BIGINT, allowNull: false },
      amountPaidCents: {
        type: DataTypes.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      subtotalCents: { type: DataTypes.BIGINT, allowNull: true },
      taxCents: { type: DataTypes.BIGINT, allowNull: true },
      totalCents: { type: DataTypes.BIGINT, allowNull: true },
      stripeAttemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      nextPaymentAttemptAt: { type: DataTypes.DATE, allowNull: true },
      periodStart: { type: DataTypes.DATE, allowNull: true },
      periodEnd: { type: DataTypes.DATE, allowNull: true },
      dueDate: { type: DataTypes.DATEONLY, allowNull: true },
      finalizedAt: { type: DataTypes.DATE, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      voidedAt: { type: DataTypes.DATE, allowNull: true },
      markedUncollectibleAt: { type: DataTypes.DATE, allowNull: true },
      hostedInvoiceUrl: { type: DataTypes.TEXT, allowNull: true },
      invoicePdf: { type: DataTypes.TEXT, allowNull: true },
      lastChargeFailureCode: { type: DataTypes.STRING(128), allowNull: true },
      lastChargeFailureMessage: { type: DataTypes.TEXT, allowNull: true },
      rawStripeSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'Invoice',
      tableName: 'invoices',
      underscored: true,
      indexes: [
        { unique: true, fields: ['stripe_invoice_id'], name: 'invoices_stripe_invoice_id_uidx' },
        { fields: ['organization_id'], name: 'invoices_organization_id_idx' },
        {
          fields: ['organization_id', 'status'],
          name: 'invoices_organization_status_idx',
        },
        { fields: ['subscription_id'], name: 'invoices_subscription_id_idx' },
      ],
    },
  );

  return Invoice;
};
