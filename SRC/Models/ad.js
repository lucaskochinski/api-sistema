'use strict';

const { Model } = require('sequelize');

/**
 * Meta Ad canonical row — anchor entidade para ligar assets, série temporal (`AdPerformanceDaily`) e IA (`CreativeAnalysis`).
 */
module.exports = (sequelize, DataTypes) => {
  class Ad extends Model {
    static associate(models) {
      Ad.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
      Ad.belongsTo(models.AdSet, { foreignKey: 'adSetId', as: 'adSet' });
      Ad.hasMany(models.CreativeAnalysis, { foreignKey: 'adId', as: 'creativeAnalyses' });
      Ad.hasMany(models.AdPerformanceDaily, {
        foreignKey: 'adId',
        as: 'performanceDailyRows',
      });
    }
  }

  Ad.init(
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
      adSetId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      metaAdId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      metaCreativeId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      metaVideoId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      /** Copy principal (mensagem); dinâmicos ⇒ primeira variante em bodies[].text */
      primaryText: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      /** Título / headline (link_data.name ou video_data.title ou dynamic titles[0]) */
      headline: {
        type: DataTypes.STRING(2048),
        allowNull: true,
      },
      /** Tipo CTA Meta (SHOP_NOW, LEARN_MORE, …) */
      ctaType: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      isDynamicCreative: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /** Payload criativo sanitizado para auditoria e evolução do parser */
      rawCreativeData: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      name: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      lastSyncedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Ad',
      tableName: 'ads',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organizationId', 'metaAdId'],
          name: 'ads_organization_meta_ad_uidx',
        },
        { fields: ['adSetId'], name: 'ads_ad_set_id_idx' },
      ],
    },
  );

  return Ad;
};
