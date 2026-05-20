'use strict';

const settingsService = require('../services/admin.settings.service');
const { rescheduleDailyMetaInsightsSync } = require('../../../Services/daily_sync.scheduler.service');
const { adminAudit } = require('../helpers/adminAudit.helper');

async function list(req, res, next) {
  try {
    adminAudit(req.user?.userId, 'admin.settings.get', {});
    const settings = await settingsService.listAllFlat();
    res.json({ settings });
  } catch (e) {
    next(e);
  }
}

async function put(req, res, next) {
  try {
    const rawBody = typeof req.body === 'object' && req.body ? req.body : {};
    /** @type {Record<string, unknown>} */
    const raw = /** @type {any} */ (rawBody);
    const keys =
      raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
        ? Object.keys(raw.settings)
        : Object.keys(raw);
    adminAudit(req.user?.userId, 'admin.settings.put', { keys });
    const { settings, touchedDailySync } = await settingsService.upsertPatchFromBody(req.body);

    /** Quando apenas outras chaves mudam, o cron permanece igual */
    /** @type {Record<string, unknown>} */
    let scheduler = {};
    if (touchedDailySync) {
      try {
        scheduler = await rescheduleDailyMetaInsightsSync();
      } catch (e) {
        const err = new Error('daily_sync_reschedule_failed');
        err.statusCode = 503;
        /** @type {any} */ (err).cause = e;
        return next(err);
      }
    }

    res.json({ settings, ...(touchedDailySync ? { scheduler } : {}) });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  put,
};
