'use strict';

const { Model } = require('sequelize');

/** Configurações globais operacionadas pelo painel admin (cron, toggles SaaS…). */
module.exports = (sequelize, DataTypes) => {
  class SystemSetting extends Model {}

  SystemSetting.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      value: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    },
    {
      sequelize,
      modelName: 'SystemSetting',
      tableName: 'system_settings',
      underscored: true,
      indexes: [
        { unique: true, fields: ['key'], name: 'system_settings_key_uidx' },
      ],
    },
  );

  return SystemSetting;
};
