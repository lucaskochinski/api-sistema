'use strict';

const { Model } = require('sequelize');

/** Junction: assigns Roles to Memberships inside an Organization */
module.exports = (sequelize, DataTypes) => {
  class MembershipRole extends Model {
    static associate(models) {
      MembershipRole.belongsTo(models.Membership, { foreignKey: 'membership_id', as: 'membership' });
      MembershipRole.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
    }
  }

  MembershipRole.init(
    {
      membershipId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
      },
    },
    {
      sequelize,
      modelName: 'MembershipRole',
      tableName: 'membership_roles',
      underscored: true,
      timestamps: false,
      indexes: [
        { fields: ['membership_id'], name: 'membership_roles_membership_id_idx' },
        { fields: ['role_id'], name: 'membership_roles_role_id_idx' },
      ],
    },
  );

  return MembershipRole;
};
