'use strict';

const db = require('../Models');
const { mergePlanLimits } = require('../Services/plan_limits.service');

/**
 * Garante chave canónica **`creative_imports_per_month`** no JSON `plans.limits`
 * e remove **`campaign_imports_per_month`** após migração (valor já preservado pelo merge).
 */
module.exports = {
  async up() {
    const plans = await db.Plan.findAll({ attributes: ['id', 'limits'] });
    for (const row of plans) {
      const merged = mergePlanLimits(row.limits || {});
      delete merged.campaign_imports_per_month;
      await row.update({ limits: merged });
    }
  },

  async down() {
    /** Irreversível — não recupera exclusão da chave legada. */
  },
};
