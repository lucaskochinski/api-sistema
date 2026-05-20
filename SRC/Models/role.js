'use strict';

const { Model } = require('sequelize');

/**
 * RBAC role catalog (global definitions). Activated per-org via MembershipRole.
 */
module.exports = (sequelize, DataTypes) => {
  class Role extends Model {
    static associate(models) {
      Role.belongsToMany(models.Permission, {
        through: models.RolePermission,
        foreignKey: 'roleId',
        otherKey: 'permissionId',
        as: 'permissions',
      });
      Role.hasMany(models.RolePermission, { foreignKey: 'roleId', as: 'rolePermissions' });
      Role.belongsToMany(models.Membership, {
        through: models.MembershipRole,
        foreignKey: 'roleId',
        otherKey: 'membershipId',
        as: 'memberships',
      });
      Role.hasMany(models.MembershipRole, { foreignKey: 'roleId', as: 'membershipRoles' });
    }
  }

  Role.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'roles',
      underscored: true,
      indexes: [{ unique: true, fields: ['key'], name: 'roles_key_uidx' }],
    },
  );

  return Role;
};
