'use strict';

const { Model } = require('sequelize');

/**
 * Google Drive OAuth container for ingest/upload flows — tenant scoped.
 */
module.exports = (sequelize, DataTypes) => {
  class IntegrationsGoogleDrive extends Model {
    static associate(models) {
      IntegrationsGoogleDrive.belongsTo(models.Organization, {
        foreignKey: 'organization_id',
        as: 'organization',
      });
    }
  }

  IntegrationsGoogleDrive.init(
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
      /** Access token short-lived; renovado via refresh_token */
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
      modelName: 'IntegrationsGoogleDrive',
      tableName: 'integrations_google_drive',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organization_id'],
          name: 'integrations_google_drive_organization_uidx',
        },
      ],
    },
  );

  return IntegrationsGoogleDrive;
};
