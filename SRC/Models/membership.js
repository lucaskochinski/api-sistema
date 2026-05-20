'use strict';

const { Model } = require('sequelize');

/**
 * Links a User to an Organization with membership lifecycle (invite/active/suspended).
 */
module.exports = (sequelize, DataTypes) => {
  class Membership extends Model {
    static associate(models) {
      Membership.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
      Membership.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
      Membership.belongsToMany(models.Role, {
        through: models.MembershipRole,
        foreignKey: 'membershipId',
        otherKey: 'roleId',
        as: 'roles',
      });
      Membership.hasMany(models.MembershipRole, {
        foreignKey: 'membershipId',
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
          fields: ['organizationId', 'userId'],
          name: 'memberships_organization_user_uidx',
        },
        { fields: ['userId'], name: 'memberships_user_id_idx' },
      ],
    },
  );

  return Membership;
};
