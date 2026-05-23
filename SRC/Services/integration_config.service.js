'use strict';

const db = require('../Models');

const SETTINGS_KEY = 'PLATFORM_INTEGRATIONS';

/** @type {Record<string, string> | null} */
let cache = null;

const FIELD_DEFS = [
  { key: 'stripe_secret_key', env: 'STRIPE_SECRET_KEY', secret: true },
  { key: 'stripe_webhook_secret', env: 'STRIPE_WEBHOOK_SECRET', secret: true },
  { key: 'stripe_publishable_key', env: 'STRIPE_PUBLISHABLE_KEY', secret: false },
  { key: 'deepgram_api_key', env: 'DEEPGRAM_API_KEY', secret: true },
  { key: 'gemini_api_key', env: 'GEMINI_API_KEY', secret: true, altEnv: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_API_KEY'] },
  { key: 'meta_app_id', env: 'META_APP_ID', secret: false },
  { key: 'meta_app_secret', env: 'META_APP_SECRET', secret: true },
  { key: 'meta_system_access_token', env: 'META_SYSTEM_ACCESS_TOKEN', secret: true },
  { key: 'public_app_url', env: 'PUBLIC_APP_URL', secret: false, altEnv: ['APP_BASE_URL'] },
  { key: 'redis_url', env: 'REDIS_URL', secret: true },
];

const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

function resolveEnv(def) {
  const primary = process.env[def.env];
  if (primary != null && String(primary).trim()) return String(primary).trim();
  for (const alt of def.altEnv || []) {
    const v = process.env[alt];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function maskSecret(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(12, s.length - 4))}${s.slice(-4)}`;
}

function getApiPublicBase() {
  const fromEnv =
    process.env.API_PUBLIC_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.API_BASE_URL ||
    '';
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/+$/, '');
  }
  return 'https://sistema-api.szpytu.easypanel.host';
}

function stripeWebhookUrl() {
  return `${getApiPublicBase()}/api/webhooks/stripe`;
}

async function readStoredIntegrations() {
  try {
    const row = await db.SystemSetting.findOne({ where: { key: SETTINGS_KEY } });
    const val = row?.value;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return /** @type {Record<string, string>} */ (val);
    }
  } catch {
    /* tabela pode não existir ainda */
  }
  return {};
}

function resolveFieldValue(def, stored) {
  const fromDb = stored[def.key];
  if (fromDb != null && String(fromDb).trim()) {
    return { value: String(fromDb).trim(), source: 'db' };
  }
  const fromEnv = resolveEnv(def);
  if (fromEnv) {
    return { value: fromEnv, source: 'env' };
  }
  return { value: '', source: 'none' };
}

async function refreshCache() {
  const stored = await readStoredIntegrations();
  /** @type {Record<string, string>} */
  const next = {};
  for (const def of FIELD_DEFS) {
    next[def.key] = resolveFieldValue(def, stored).value;
  }
  cache = next;
  return next;
}

async function loadIntegrationConfig() {
  return refreshCache();
}

/** Valor efectivo (DB → env). Síncrono após bootstrap. */
function get(fieldKey) {
  if (cache && cache[fieldKey] != null && String(cache[fieldKey]).trim()) {
    return String(cache[fieldKey]).trim();
  }
  const def = FIELD_DEFS.find((f) => f.key === fieldKey);
  if (!def) return '';
  return resolveEnv(def);
}

function getPublicAppUrl() {
  return (
    get('public_app_url') ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

async function getAdminIntegrationsView() {
  const stored = await readStoredIntegrations();
  /** @type {Record<string, { configured: boolean, source: string, masked?: string, value?: string }>} */
  const fields = {};
  /** @type {Record<string, string>} */
  const values = {};

  for (const def of FIELD_DEFS) {
    const resolved = resolveFieldValue(def, stored);
    const configured = Boolean(resolved.value);
    if (def.secret) {
      fields[def.key] = {
        configured,
        source: resolved.source,
        masked: configured ? maskSecret(resolved.value) : '',
      };
    } else {
      fields[def.key] = {
        configured,
        source: resolved.source,
        value: resolved.value,
      };
      values[def.key] = resolved.value;
    }
  }

  return {
    apiBaseUrl: getApiPublicBase(),
    webhooks: {
      stripe: {
        url: stripeWebhookUrl(),
        events: STRIPE_WEBHOOK_EVENTS,
      },
    },
    fields,
    values,
  };
}

/**
 * @param {Record<string, unknown>} body
 */
async function upsertIntegrationsFromBody(body) {
  const patch =
    body && typeof body === 'object' && body.integrations && typeof body.integrations === 'object'
      ? body.integrations
      : body;

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const err = new Error('integrations_body_invalid');
    err.statusCode = 400;
    throw err;
  }

  const stored = await readStoredIntegrations();
  /** @type {Record<string, string>} */
  const next = { ...stored };
  let changed = false;

  for (const def of FIELD_DEFS) {
    if (!Object.prototype.hasOwnProperty.call(patch, def.key)) continue;
    const raw = patch[def.key];
    if (raw === null || raw === undefined) continue;
    const str = String(raw).trim();
    if (def.secret && (str === '' || str.includes('••••'))) {
      continue;
    }
    next[def.key] = str;
    changed = true;
  }

  if (!changed) {
    const err = new Error('integrations_empty_patch');
    err.statusCode = 400;
    throw err;
  }

  await db.sequelize.transaction(async (trx) => {
    const [row, created] = await db.SystemSetting.findOrCreate({
      where: { key: SETTINGS_KEY },
      defaults: { key: SETTINGS_KEY, value: next },
      transaction: trx,
    });
    if (!created) {
      await row.update({ value: next }, { transaction: trx });
    }
  });

  await refreshCache();

  try {
    const billing = require('../Features/Billing/billing.service');
    if (typeof billing.resetStripeClient === 'function') {
      billing.resetStripeClient();
    }
  } catch {
    /* opcional */
  }
  try {
    const stripePlans = require('./stripe_plans.service');
    if (typeof stripePlans.resetStripeClient === 'function') {
      stripePlans.resetStripeClient();
    }
  } catch {
    /* opcional */
  }

  return getAdminIntegrationsView();
}

module.exports = {
  SETTINGS_KEY,
  FIELD_DEFS,
  STRIPE_WEBHOOK_EVENTS,
  loadIntegrationConfig,
  refreshCache,
  get,
  getPublicAppUrl,
  getApiPublicBase,
  stripeWebhookUrl,
  getAdminIntegrationsView,
  upsertIntegrationsFromBody,
  maskSecret,
};
