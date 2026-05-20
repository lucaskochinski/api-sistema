'use strict';

const { Model } = require('sequelize');

/**
 * Registro único global de vídeo/asset (dedupe). Autorização de uso por Organization via OrganizationMediaClaim.
 */
module.exports = (sequelize, DataTypes) => {
  class MediaAsset extends Model {
    static associate(models) {
      MediaAsset.hasMany(models.OrganizationMediaClaim, {
        foreignKey: 'mediaId',
        as: 'organizationClaims',
      });
      MediaAsset.hasMany(models.CreativeAnalysis, { foreignKey: 'mediaId', as: 'creativeAnalyses' });
    }
  }

  MediaAsset.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      metaVideoId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
      googleDriveFileId: {
        type: DataTypes.STRING(128),
        allowNull: true,
        unique: true,
      },
      processingStatus: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'ingest',
      },
      checksum: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      ingestMetadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'MediaAsset',
      tableName: 'media_assets',
      underscored: true,
      indexes: [
        {
          fields: ['processingStatus'],
          name: 'media_assets_processing_status_idx',
        },
      ],
    },
  );

  return MediaAsset;
};
