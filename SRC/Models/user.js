'use strict';

const { Model } = require('sequelize');

/**
 * Authenticated principal. Multi-tenant access is expressed via Membership (+ RBAC roles).
 */
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Membership, { foreignKey: 'user_id', as: 'memberships' });
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(320),
        allowNull: false,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      authProviderSubject: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      indexes: [{ unique: true, fields: ['email'], name: 'users_email_uidx' }],
      defaultScope: {
        attributes: { exclude: ['passwordHash'] },
      },
    },
  );

  return User;
};
