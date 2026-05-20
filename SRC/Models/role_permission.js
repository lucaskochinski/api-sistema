'use strict';

const { Model } = require('sequelize');

/** Junction: which Permissions are granted by each Role */
module.exports = (sequelize, DataTypes) => {
  class RolePermission extends Model {
    static associate(models) {
      RolePermission.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
      RolePermission.belongsTo(models.Permission, { foreignKey: 'permission_id', as: 'permission' });
    }
  }

  RolePermission.init(
    {
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      permissionId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      sequelize,
      modelName: 'RolePermission',
      tableName: 'role_permissions',
      underscored: true,
      timestamps: false,
      indexes: [
        { fields: ['role_id'], name: 'role_permissions_role_id_idx' },
        { fields: ['permission_id'], name: 'role_permissions_permission_id_idx' },
      ],
    },
  );

  return RolePermission;
};
