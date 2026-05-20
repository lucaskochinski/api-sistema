'use strict';

const axios = require('axios');
const { Op } = require('sequelize');
const { IntegrationsMeta, sequelize } = require('../../Models');
const cipher = require('../../Utils/crypto');

const REQUIRED_SCOPES = ['ads_read', 'ads_management'];
const GRAPH_BASE = () => {
  const v = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const vn = v.startsWith('v') ? v : `v${v}`;
  return `https://graph.facebook.com/${vn}`;
};
const META_OAUTH_SCOPES =
  process.env.META_OAUTH_SCOPES || 'ads_read,ads_management,public_profile';

/** Margem antes do vencimento para trocar long-lived por novo (segundos). Default 7 dias. */
const REFRESH_BEFORE_EXPIRY_SEC = Number(
  process.env.META_TOKEN_REFRESH_BEFORE_EXPIRY_SEC || 7 * 24 * 60 * 60,
);

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    throw new Error(`${name}_not_configured`);
  }
  return v.trim();
}

function appAccessTokenForDebug() {
  const id = requireEnv('META_APP_ID');
  const secret = requireEnv('META_APP_SECRET');
  return `${id}|${secret}`;
}

/**
 * Monta URL de autorização OAuth Meta (usuário autoriza no facebook.com).

 */
function buildAuthorizeUrl(state) {
  requireEnv('META_APP_ID');
  const redirectUri = requireEnv('META_REDIRECT_URI');
  const vn = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const version = vn.startsWith('v') ? vn : `v${vn}`;
  const qs = new URLSearchParams({
    client_id: requireEnv('META_APP_ID'),
    redirect_uri: redirectUri,
    scope: META_OAUTH_SCOPES,
    state: String(state),
    response_type: 'code',
  });
  return `https://www.facebook.com/${version}/dialog/oauth?${qs.toString()}`;
}

async function exchangeCodeForShortLivedToken(code) {
  const { data } = await axios.get(`${GRAPH_BASE()}/oauth/access_token`, {
    params: {
      client_id: requireEnv('META_APP_ID'),
      client_secret: requireEnv('META_APP_SECRET'),
      redirect_uri: requireEnv('META_REDIRECT_URI'),
      code,
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (!data?.access_token) {
    const err = new Error('meta_code_exchange_failed');
    err.statusCode = 400;
    err.meta = { details: data };
    throw err;
  }
  return data;
}

async function upgradeToLongLivedToken(shortLivedAccessToken) {
  const { data } = await axios.get(`${GRAPH_BASE()}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: requireEnv('META_APP_ID'),
      client_secret: requireEnv('META_APP_SECRET'),
      fb_exchange_token: shortLivedAccessToken,
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (!data?.access_token) {
    const err = new Error('meta_long_lived_upgrade_failed');
    err.statusCode = 400;
    err.meta = { details: data };
    throw err;
  }
  return data;
}

async function debugToken(userAccessToken) {
  const { data } = await axios.get('https://graph.facebook.com/debug_token', {
    params: {
      input_token: userAccessToken,
      access_token: appAccessTokenForDebug(),
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  const d = data?.data;
  if (!d || d.is_valid === false) {
    const err = new Error('meta_token_invalid');
    err.statusCode = 401;
    err.meta = { details: data };
    throw err;
  }
  return d;
}

function assertRequiredScopes(scopeList) {
  const scopes = Array.isArray(scopeList) ? scopeList : [];
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  if (missing.length > 0) {
    const err = new Error(`meta_missing_scopes:${missing.join(',')}`);
    err.statusCode = 403;
    throw err;
  }
}

async function upsertEncryptedIntegration(organizationId, accessTokenPlain, oauthMetadata) {
  const debug = await debugToken(accessTokenPlain);
  assertRequiredScopes(debug.scopes);
  const expiresAtUnix = typeof debug.expires_at === 'number' ? debug.expires_at : null;
  const tokenExpiresAt = expiresAtUnix ? new Date(expiresAtUnix * 1000) : null;
  const aad = String(organizationId);
  const accessCipher = cipher.encrypt(accessTokenPlain, aad);
  const metadata = {
    ...oauthMetadata,
    graphUserId: debug.user_id != null ? String(debug.user_id) : null,
    scopes: debug.scopes || [],
    lastValidatedAt: new Date().toISOString(),
  };

  await sequelize.transaction(async (t) => {
    const existing = await IntegrationsMeta.findOne({
      where: { organizationId },
      transaction: t,
      lock: t.UPDATE,
    });
    if (existing) {
      await existing.update(
        {
          accessTokenCipher: accessCipher,
          tokenExpiresAt,
          oauthMetadata: { ...existing.oauthMetadata, ...metadata },
          status: 'active',
        },
        { transaction: t },
      );
    } else {
      await IntegrationsMeta.create(
        {
          organizationId,
          accessTokenCipher: accessCipher,
          refreshTokenCipher: null,
          tokenExpiresAt,
          oauthMetadata: metadata,
          status: 'active',
        },
        { transaction: t },
      );
    }
  });

  /** Não registrar token nem cipher */
  console.info('[meta] integration upsert ok', {
    organizationId,
    scopesCount: metadata.scopes?.length,
  });
}

/**
 * Fluxo OAuth: authorization_code → short-lived → long-lived → debug → persistência cifrada.

 */
async function exchangeCodeAndPersistTokens(organizationId, code) {
  if (!code || String(code).trim() === '') {
    const err = new Error('missing_authorization_code');
    err.statusCode = 400;
    throw err;
  }
  const shortLived = await exchangeCodeForShortLivedToken(String(code).trim());
  const longLivedData = await upgradeToLongLivedToken(shortLived.access_token);
  const accessPlain = longLivedData.access_token;
  /** expires_in opcionalmente complementa meta — validação oficial via debug dentro de persist */
  const preliminaryMeta = {};
  if (typeof longLivedData.expires_in === 'number') {
    preliminaryMeta.longLivedExpiresInSec = longLivedData.expires_in;
  }
  await upsertEncryptedIntegration(organizationId, accessPlain, preliminaryMeta);
}

async function persistRefreshedToken(organizationId, newAccessPlain, row) {
  const debug = await debugToken(newAccessPlain);
  assertRequiredScopes(debug.scopes);
  const expiresAtUnix = typeof debug.expires_at === 'number' ? debug.expires_at : null;
  const tokenExpiresAt = expiresAtUnix ? new Date(expiresAtUnix * 1000) : null;
  const aad = String(organizationId);
  const accessCipher = cipher.encrypt(newAccessPlain, aad);
  await row.update({
    accessTokenCipher: accessCipher,
    tokenExpiresAt,
    oauthMetadata: {
      ...row.oauthMetadata,
      graphUserId: debug.user_id != null ? String(debug.user_id) : row.oauthMetadata?.graphUserId,
      scopes: debug.scopes || row.oauthMetadata?.scopes,
      lastRefreshedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
    },
    status: 'active',
  });
  await row.reload();
}

/**
 * Único ponto que devolve o access token Meta em plaintext para jobs internos.
 * Os controllers HTTP não devem retornar este valor ao cliente navegador.
 */
async function getValidAccessTokenForOrganization(organizationId) {
  const row = await IntegrationsMeta.findOne({
    where: { organizationId, status: { [Op.ne]: 'revoked' } },
  });
  if (!row || !row.accessTokenCipher) {
    const err = new Error('meta_integration_not_found');
    err.statusCode = 404;
    throw err;
  }
  const aad = String(organizationId);

  let plain;
  try {
    plain = cipher.decrypt(row.accessTokenCipher, aad);
  } catch (_) {
    const err = new Error('meta_token_decrypt_failed');
    err.statusCode = 500;
    throw err;
  }

  const expiresAtUnixFromRow = row.tokenExpiresAt
    ? Math.floor(new Date(row.tokenExpiresAt).getTime() / 1000)
    : null;

  let mustRefresh =
    expiresAtUnixFromRow == null ||
    expiresAtUnixFromRow * 1000 - Date.now() < REFRESH_BEFORE_EXPIRY_SEC * 1000;

  if (!mustRefresh) {
    try {
      const dbg = await debugToken(plain);
      if (
        dbg.is_valid &&
        typeof dbg.expires_at === 'number' &&
        dbg.expires_at * 1000 - Date.now() < REFRESH_BEFORE_EXPIRY_SEC * 1000
      ) {
        mustRefresh = true;
      }
      if (!dbg.is_valid) {
        mustRefresh = true;
      }
    } catch (e) {
      mustRefresh = true;
      console.warn('[meta] debug_token preflight failed; delegating refresh branch');
    }
  }

  if (mustRefresh) {
    const longData = await upgradeToLongLivedToken(plain);
    await persistRefreshedToken(organizationId, longData.access_token, row);
  }

  await row.reload();

  let finalPlain;
  try {
    finalPlain = cipher.decrypt(row.accessTokenCipher, aad);
  } catch (e2) {
    throw e2;
  }

  console.info('[meta] issued internal token context', {
    organizationId,
    expiresAtHint: row.tokenExpiresAt instanceof Date ? row.tokenExpiresAt.toISOString() : null,
  });

  return {
    accessToken: finalPlain,
    expiresAt: row.tokenExpiresAt,
    oauthMetadata: row.oauthMetadata || {},
  };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeAndPersistTokens,
  exchangeCodeForTokens: exchangeCodeAndPersistTokens,
  getValidAccessTokenForOrganization,
  getValidToken: getValidAccessTokenForOrganization,
};
