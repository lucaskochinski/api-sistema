'use strict';

const { Model } = require('sequelize');

/** Catálogo de planos comercializáveis HOOKO (referência Stripe + limites). */
module.exports = (sequelize, DataTypes) => {
  class Plan extends Model {
    static associate(models) {
      Plan.hasMany(models.Subscription, { foreignKey: 'planId', as: 'subscriptions' });
      Plan.belongsTo(models.Organization, {
        foreignKey: 'custom_organization_id',
        as: 'customOrganization',
      });
    }
  }

  Plan.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tierKey: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      displayName: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      /** Stripe recurring price slug for monthly billing snapshot */
      stripePriceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      stripeProductId: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: 'stripe_product_id',
      },
      priceAmountCents: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'price_amount_cents',
      },
      priceCurrency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'brl',
        field: 'price_currency',
      },
      limits: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      trialDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'trial_days',
        validate: { min: 0, max: 730 },
      },
      /** Se aparece na vitrine `/api/plans/public` quando ativo */
      isPublic: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_public',
      },
      /** Plano sob demanda: só esse tenant pode fazer checkout */
      customOrganizationId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'custom_organization_id',
      },
    },
    {
      sequelize,
      modelName: 'Plan',
      tableName: 'plans',
      underscored: true,
      indexes: [
        { unique: true, fields: ['tier_key'], name: 'plans_tier_key_uidx' },
        { fields: ['is_active'], name: 'plans_is_active_idx' },
        {
          fields: ['custom_organization_id'],
          name: 'plans_custom_organization_id_idx',
        },
        {
          fields: ['is_active', 'is_public'],
          name: 'plans_active_public_idx',
        },
      ],
    },
  );

  return Plan;
};
