'use strict';

const { Model } = require('sequelize');

/**
 * Tenant root: all billable scope and tenant-scoped entities reference organization_id.
 */
module.exports = (sequelize, DataTypes) => {
  class Organization extends Model {
    static associate(models) {
      Organization.hasMany(models.Membership, {
        foreignKey: 'organization_id',
        as: 'memberships',
      });
      Organization.hasMany(models.IntegrationsMeta, {
        foreignKey: 'organization_id',
        as: 'metaIntegrations',
      });
      Organization.hasMany(models.IntegrationsGoogleDrive, {
        foreignKey: 'organization_id',
        as: 'googleDriveIntegrations',
      });
      Organization.hasMany(models.MetaAdAccount, {
        foreignKey: 'organization_id',
        as: 'metaAdAccounts',
      });
      Organization.hasMany(models.Campaign, { foreignKey: 'organization_id', as: 'campaigns' });
      Organization.hasMany(models.AdSet, { foreignKey: 'organization_id', as: 'adSets' });
      Organization.hasMany(models.Ad, { foreignKey: 'organization_id', as: 'ads' });
      Organization.hasMany(models.OrganizationMediaClaim, {
        foreignKey: 'organization_id',
        as: 'mediaClaims',
      });
      Organization.hasMany(models.CreativeAnalysis, {
        foreignKey: 'organization_id',
        as: 'creativeAnalyses',
      });
      Organization.hasMany(models.AdPerformanceDaily, {
        foreignKey: 'organization_id',
        as: 'adPerformanceDaily',
      });
      Organization.hasMany(models.Subscription, {
        foreignKey: 'organization_id',
        as: 'subscriptions',
      });
      Organization.hasMany(models.Invoice, { foreignKey: 'organization_id', as: 'invoices' });
      Organization.hasMany(models.WebhookEventLog, {
        foreignKey: 'organization_id',
        as: 'webhookEventLogs',
      });
      Organization.hasMany(models.PaymentTransaction, {
        foreignKey: 'organization_id',
        as: 'paymentTransactions',
      });
      Organization.hasMany(models.UsageCounter, {
        foreignKey: 'organization_id',
        as: 'usageCounters',
      });
      Organization.hasMany(models.Plan, {
        foreignKey: 'custom_organization_id',
        as: 'exclusivePlans',
      });
    }
  }

  Organization.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      stripeCustomerId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Organization',
      tableName: 'organizations',
      underscored: true,
      indexes: [
        { unique: true, fields: ['slug'], name: 'organizations_slug_uidx' },
        { fields: ['stripe_customer_id'], name: 'organizations_stripe_customer_id_idx' },
      ],
    },
  );

  return Organization;
};
