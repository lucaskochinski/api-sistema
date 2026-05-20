'use strict';

const { Model } = require('sequelize');

/**
 * Assinatura Stripe (ou gateways futuros espelhados) — sempre vinculada a uma Organization.
 * Campos adicionais refletem o ciclo de vida completo (trial, pause, períodos Stripe, snapshots).
 */
module.exports = (sequelize, DataTypes) => {
  class Subscription extends Model {
    static associate(models) {
      Subscription.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
      Subscription.belongsTo(models.Plan, { foreignKey: 'planId', as: 'plan' });
      Subscription.hasMany(models.Invoice, {
        foreignKey: 'subscriptionId',
        as: 'invoices',
      });
      Subscription.hasMany(models.PaymentTransaction, {
        foreignKey: 'subscriptionId',
        as: 'paymentTransactions',
      });
    }
  }

  Subscription.init(
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
      planId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      stripeSubscriptionId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      stripePriceIdSnapshot: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      stripeLatestInvoiceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(48),
        allowNull: false,
        defaultValue: 'incomplete',
      },
      cancelAtPeriodEnd: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      currentPeriodStart: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      currentPeriodEnd: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      trialEndsAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      canceledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      pausedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      collectionPausedReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      billingMetadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      rawStripeSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'Subscription',
      tableName: 'subscriptions',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['stripeSubscriptionId'],
          name: 'subscriptions_stripe_sub_uidx',
        },
        { fields: ['organizationId'], name: 'subscriptions_organization_id_idx' },
        {
          fields: ['organizationId', 'status'],
          name: 'subscriptions_organization_status_idx',
        },
      ],
    },
  );

  return Subscription;
};
