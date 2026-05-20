'use strict';

const { Model } = require('sequelize');

/**
 * Atomic permission catalog (resource + action); composed into Roles.
 */
module.exports = (sequelize, DataTypes) => {
  class Permission extends Model {
    static associate(models) {
      Permission.belongsToMany(models.Role, {
        through: models.RolePermission,
        foreignKey: 'permissionId',
        otherKey: 'role_id',
        as: 'roles',
      });
      Permission.hasMany(models.RolePermission, {
        foreignKey: 'permissionId',
        as: 'rolePermissions',
      });
    }
  }

  Permission.init(
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
      resource: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'Permission',
      tableName: 'permissions',
      underscored: true,
      indexes: [
        { unique: true, fields: ['key'], name: 'permissions_key_uidx' },
        { fields: ['resource', 'action'], name: 'permissions_resource_action_idx' },
      ],
    },
  );

  return Permission;
};
