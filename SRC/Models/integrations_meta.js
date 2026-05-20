'use strict';

const { Model } = require('sequelize');

/**
 * Meta Ads OAuth credential container (scoped to one Organization).
 * Never log raw ciphertext; decrypt only inside privileged ingestion services.
 */
module.exports = (sequelize, DataTypes) => {
  class IntegrationsMeta extends Model {
    static associate(models) {
      IntegrationsMeta.belongsTo(models.Organization, {
        foreignKey: 'organizationId',
        as: 'organization',
      });
    }
  }

  IntegrationsMeta.init(
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
      /** Serialized ciphertext envelope (recommended: KMS + version tag) */
      accessTokenCipher: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      refreshTokenCipher: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      tokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      oauthMetadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'active',
      },
    },
    {
      sequelize,
      modelName: 'IntegrationsMeta',
      tableName: 'integrations_meta',
      underscored: true,
      indexes: [
        { unique: true, fields: ['organizationId'], name: 'integrations_meta_organization_uidx' },
        { fields: ['status'], name: 'integrations_meta_status_idx' },
      ],
    },
  );

  return IntegrationsMeta;
};
