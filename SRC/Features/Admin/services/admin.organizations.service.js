'use strict';

const db = require('../../../Models');

async function listOrganizations({ limit, offset, search }) {
  const where = {};
  if (search) {
    where[db.Sequelize.Op.or] = [
      { name: { [db.Sequelize.Op.iLike]: `%${search}%` } },
      { slug: { [db.Sequelize.Op.iLike]: `%${search}%` } },
    ];
  }

  return db.Organization.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'name', 'slug', 'stripeCustomerId', 'createdAt', 'updatedAt'],
    include: [
      {
        model: db.Subscription,
        as: 'subscriptions',
        attributes: ['id', 'status'],
        separate: true,
        limit: 5,
        order: [['createdAt', 'DESC']],
      },
    ],
  });
}

async function getOrganizationById(organizationId) {
  return db.Organization.findByPk(organizationId, {
    include: [
      {
        model: db.Subscription,
        as: 'subscriptions',
        separate: true,
        include: [{ model: db.Plan, as: 'plan', required: false }],
      },
      {
        model: db.Membership,
        as: 'memberships',
        attributes: ['id', 'status', 'userId', 'createdAt'],
      },
      {
        model: db.Invoice,
        as: 'invoices',
        separate: true,
        limit: 25,
        order: [['createdAt', 'DESC']],
      },
    ],
  });
}

module.exports = {
  listOrganizations,
  getOrganizationById,
};
