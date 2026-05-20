'use strict';

const { Model } = require('sequelize');

/**
 * Resultado pontual de IA sobre um par Ad + Media dentro de uma Organization.
 * Contém também snapshot consolidado das métricas no momento da análise (`performanceSnapshot`).
 * A série temporal de performance detalhada vive em `AdPerformanceDaily`.
 */
module.exports = (sequelize, DataTypes) => {
  class CreativeAnalysis extends Model {
    static associate(models) {
      CreativeAnalysis.belongsTo(models.Organization, {
        foreignKey: 'organizationId',
        as: 'organization',
      });
      CreativeAnalysis.belongsTo(models.Ad, { foreignKey: 'adId', as: 'ad' });
      CreativeAnalysis.belongsTo(models.MediaAsset, {
        foreignKey: 'mediaId',
        as: 'mediaAsset',
      });
    }
  }

  CreativeAnalysis.init(
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
      adId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      mediaId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      /** CTR agregado (0–100 ou 0–1 conforme canonical interno definido pela camada domínio) */
      ctr: {
        type: DataTypes.DECIMAL(24, 12),
        allowNull: true,
      },
      roas: {
        type: DataTypes.DECIMAL(24, 8),
        allowNull: true,
      },
      spend: {
        type: DataTypes.DECIMAL(24, 6),
        allowNull: true,
      },
      performanceSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      aiAnalysis: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      analyzedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      /** Opcional para rotular janelas (campaign window, relatório mensal, etc.). */
      periodKey: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      /** Versão/registro determinístico de pipeline IA (replay / audits) */
      analysisVersion: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      vturbVideoId: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'CreativeAnalysis',
      tableName: 'creative_analyses',
      underscored: true,
      indexes: [
        { fields: ['organizationId'], name: 'creative_analyses_organization_id_idx' },
        { fields: ['adId'], name: 'creative_analyses_ad_id_idx' },
        { fields: ['mediaId'], name: 'creative_analyses_media_id_idx' },
        { fields: ['organizationId', 'analyzedAt'], name: 'creative_analyses_org_analyzed_at_idx' },
        { fields: ['organizationId', 'adId', 'analyzedAt'], name: 'creative_analyses_org_ad_ts_idx' },
      ],
    },
  );

  return CreativeAnalysis;
};
