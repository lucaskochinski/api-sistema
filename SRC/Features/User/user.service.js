'use strict';

const { Op } = require('sequelize');
const { User, Membership } = require('../../Models');

/**
 * IDs de usuários com membership “ativa” (ou sem status) em qualquer uma das orgs dadas.
 * @param {string[]} organizationIds
 */
async function distinctActiveMemberUserIds(organizationIds) {
  const uniq = [...new Set(organizationIds.map(String).filter(Boolean))];
  if (!uniq.length) return [];

  const rows = await Membership.findAll({
    where: {
      organizationId: { [Op.in]: uniq },
      [Op.or]: [{ status: 'active' }, { status: null }],
    },
    attributes: ['userId'],
    raw: true,
  });

  /** raw pode expor camelCase conforme modelo */
  const ids = rows.map((r) => r.userId ?? r.user_id).filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Lista usuários que compartilham pelo menos uma das organizações indicadas (isolamento tenant).
 */
async function listUsersInOrganizations(organizationIds) {
  const userIds = await distinctActiveMemberUserIds(organizationIds);
  if (!userIds.length) return [];

  return User.findAll({
    where: { id: { [Op.in]: userIds } },
    order: [['createdAt', 'DESC']],
  });
}

/**
 * Quantidade distinta de usuários nas orgs (mesmo critério de membership ativa/null).
 */
async function countUsersInOrganizations(organizationIds) {
  const userIds = await distinctActiveMemberUserIds(organizationIds);
  return userIds.length;
}

module.exports = {
  listUsersInOrganizations,
  countUsersInOrganizations,
};
