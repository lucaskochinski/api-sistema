'use strict';

const db = require('../Models');
const { mergePlanLimits } = require('../Services/plan_limits.service');

/**
 * Garante **`plans.limits`** com chaves canônicas SaaS (preserva extras legados).
 * Inclui `creative_imports_per_month` (merge lê legado `campaign_imports_per_month`).
 */

module.exports = {
  async up() {
    const plans = await db.Plan.findAll({ attributes: ['id', 'limits'] });
    for (const row of plans) {
      const merged = mergePlanLimits(row.limits || {});
      await row.update({ limits: merged });
    }
  },

  async down() {
    /** Irreversível — não remove chaves adicionadas por merge. */
  },
};
