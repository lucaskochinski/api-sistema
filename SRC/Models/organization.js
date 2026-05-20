'use strict';

const { Model } = require('sequelize');

/**
 * Tenant root: all billable scope and tenant-scoped entities reference organization_id.
 */
module.exports = (sequelize, DataTypes) => {
  class Organization extends Model {
    static associate(models) {
      Organization.hasMany(models.Membership, {
        foreignKey: 'organizationId',
        as: 'memberships',
      });
      Organization.hasMany(models.IntegrationsMeta, {
        foreignKey: 'organizationId',
        as: 'metaIntegrations',
      });
      Organization.hasMany(models.IntegrationsGoogleDrive, {
        foreignKey: 'organizationId',
        as: 'googleDriveIntegrations',
      });
      Organization.hasMany(models.MetaAdAccount, {
        foreignKey: 'organizationId',
        as: 'metaAdAccounts',
      });
      Organization.hasMany(models.Campaign, { foreignKey: 'organizationId', as: 'campaigns' });
      Organization.hasMany(models.AdSet, { foreignKey: 'organizationId', as: 'adSets' });
      Organization.hasMany(models.Ad, { foreignKey: 'organizationId', as: 'ads' });
      Organization.hasMany(models.OrganizationMediaClaim, {
        foreignKey: 'organizationId',
        as: 'mediaClaims',
      });
      Organization.hasMany(models.CreativeAnalysis, {
        foreignKey: 'organizationId',
        as: 'creativeAnalyses',
      });
      Organization.hasMany(models.AdPerformanceDaily, {
        foreignKey: 'organizationId',
        as: 'adPerformanceDaily',
      });
      Organization.hasMany(models.Subscription, {
        foreignKey: 'organizationId',
        as: 'subscriptions',
      });
      Organization.hasMany(models.Invoice, { foreignKey: 'organizationId', as: 'invoices' });
      Organization.hasMany(models.WebhookEventLog, {
        foreignKey: 'organizationId',
        as: 'webhookEventLogs',
      });
      Organization.hasMany(models.PaymentTransaction, {
        foreignKey: 'organizationId',
        as: 'paymentTransactions',
      });
      Organization.hasMany(models.UsageCounter, {
        foreignKey: 'organizationId',
        as: 'usageCounters',
      });
      Organization.hasMany(models.Plan, {
        foreignKey: 'customOrganizationId',
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
        { fields: ['stripeCustomerId'], name: 'organizations_stripe_customer_id_idx' },
      ],
    },
  );

  return Organization;
};
