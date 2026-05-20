'use strict';

const db = require('../../../Models');
const {
  parseHHMMToCronUtc,
  extractDailySyncHHMM,
} = require('../../../Services/daily_sync.scheduler.service');

/** Chaves snake_case maiúsculas alfanuméricas + underscore */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function badRequest(code) {
  const err = new Error(code);
  err.statusCode = 400;
  return err;
}

/** @returns {Record<string, unknown>} */
function coerceIncomingPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('settings_body_invalid');
  }
  /** @type {Record<string, unknown>} */
  const b = /** @type {unknown} */ (body);
  if ('settings' in b) {
    const inner = /** @type {{ settings?: unknown }} */ (b).settings;
    if (inner == null || typeof inner !== 'object' || Array.isArray(inner)) {
      throw badRequest('settings_object_invalid');
    }
    return { ...inner };
  }
  return { ...b };
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function normalizeStoredValue(key, value) {
  if (value === undefined) {
    throw badRequest('setting_value_required');
  }
  if (key === 'DAILY_SYNC_TIME') {
    parseHHMMToCronUtc(value);
    const hhmm = extractDailySyncHHMM(value);
    return { time: hhmm };
  }
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'object'
  ) {
    throw badRequest('setting_value_type_not_supported');
  }
  return value;
}

async function listAllFlat() {
  const rows = await db.SystemSetting.findAll({
    attributes: ['key', 'value'],
    order: [['key', 'ASC']],
  });
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const r of rows) {
    out[r.key] = r.value;
  }
  return out;
}

/**
 * Aplica PATCH em chaves nomeadas em `system_settings`.
 * Se `DAILY_SYNC_TIME` for alterado, marca `touchedDailySync` para reagendar BullMQ.
 */
async function upsertPatchFromBody(body) {
  const patch = coerceIncomingPatch(body);
  const entries = Object.entries(patch);

  if (entries.length === 0) {
    throw badRequest('settings_empty_patch');
  }

  /** @type {Array<[string, unknown]>} */
  const normalizedPairs = [];

  let touchedDailySync = false;

  for (let [rawKey, rawVal] of entries) {
    const key = String(rawKey);
    if (!KEY_RE.test(key)) {
      throw badRequest('setting_key_invalid');
    }
    const value = normalizeStoredValue(key, rawVal);
    normalizedPairs.push([key, value]);
    if (key === 'DAILY_SYNC_TIME') {
      touchedDailySync = true;
    }
  }

  await db.sequelize.transaction(async (trx) => {
    for (const [key, value] of normalizedPairs) {
      const [row, created] = await db.SystemSetting.findOrCreate({
        where: { key },
        defaults: { key, value },
        transaction: trx,
      });
      if (!created) {
        await row.update({ value }, { transaction: trx });
      }
    }
  });

  const settings = await listAllFlat();
  return { settings, touchedDailySync };
}

module.exports = {
  listAllFlat,
  upsertPatchFromBody,
  KEY_RE,
};
