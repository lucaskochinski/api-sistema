'use strict';

const { Model } = require('sequelize');

/**
 * Links a User to an Organization with membership lifecycle (invite/active/suspended).
 */
module.exports = (sequelize, DataTypes) => {
  class Membership extends Model {
    static associate(models) {
      Membership.belongsTo(models.Organization, { foreignKey: 'organization_id', as: 'organization' });
      Membership.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      Membership.belongsToMany(models.Role, {
        through: models.MembershipRole,
        foreignKey: 'membership_id',
        otherKey: 'role_id',
        as: 'roles',
      });
      Membership.hasMany(models.MembershipRole, {
        foreignKey: 'membership_id',
        as: 'membershipRoles',
      });
    }
  }

  Membership.init(
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
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'active',
        validate: {
          isIn: [['invited', 'active', 'suspended']],
        },
      },
    },
    {
      sequelize,
      modelName: 'Membership',
      tableName: 'memberships',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['organization_id', 'user_id'],
          name: 'memberships_organization_user_uidx',
        },
        { fields: ['user_id'], name: 'memberships_user_id_idx' },
      ],
    },
  );

  return Membership;
};
