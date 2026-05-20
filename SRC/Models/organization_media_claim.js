'use strict';

const { Model } = require('sequelize');

/**
 * Declara direito/uso legitimo de uma Organization sobre um MediaAsset global (registry compartilhado).
 */
module.exports = (sequelize, DataTypes) => {
  class OrganizationMediaClaim extends Model {
    static associate(models) {
      OrganizationMediaClaim.belongsTo(models.Organization, {
        foreignKey: 'organizationId',
        as: 'organization',
      });
      OrganizationMediaClaim.belongsTo(models.MediaAsset, { foreignKey: 'mediaId', as: 'mediaAsset' });
    }
  }

  OrganizationMediaClaim.init(
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
      mediaId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /** Origin label: meta_sync | google_drive_upload | manual | import_pipeline */
      source: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'meta_sync',
      },
      claimMetadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'OrganizationMediaClaim',
      tableName: 'organization_media_claims',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organizationId', 'mediaId'],
          name: 'organization_media_claims_org_media_uidx',
        },
        { fields: ['mediaId'], name: 'organization_media_claims_media_id_idx' },
      ],
    },
  );

  return OrganizationMediaClaim;
};
