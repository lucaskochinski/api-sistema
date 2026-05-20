'use strict';

const plansService = require('./plans.service');

async function listPublic(req, res, next) {
  try {
    const rows = await plansService.listPublicActivePlans();
    res.json({
      items: rows.map((r) => r.get({ plain: true })),
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listPublic,
};
