'use strict';

const db = require('../../Models');

/** Vitrine para landing — sem dados sensíveis (sem Stripe IDs). */
async function listPublicActivePlans() {
  return db.Plan.findAll({
    where: { isActive: true, isPublic: true },
    attributes: ['id', 'tierKey', 'displayName', 'limits', 'trialDays'],
    order: [['displayName', 'ASC']],
  });
}

module.exports = {
  listPublicActivePlans,
};
