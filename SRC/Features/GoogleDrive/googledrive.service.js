'use strict';

const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const { Op } = require('sequelize');
const { IntegrationsGoogleDrive, sequelize } = require('../../Models');
const cipher = require('../../Utils/crypto');

const MIN_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
  'profile',
];

const BUFFER_MS = Number(process.env.GOOGLE_TOKEN_REFRESH_BUFFER_MS || 5 * 60 * 1000);

function requireEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    throw new Error(`${name}_not_configured`);
  }
  return v.trim();
}

function buildOAuthClient() {
  return new OAuth2Client(
    requireEnv('GOOGLE_CLIENT_ID'),
    requireEnv('GOOGLE_CLIENT_SECRET'),
    requireEnv('GOOGLE_REDIRECT_URI'),
  );
}

function oauthScopesEnv() {
  const raw = process.env.GOOGLE_OAUTH_SCOPES;
  if (!raw || raw.trim() === '') return [...MIN_SCOPES];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** URL Google OAuth offline + consent (garantia de `refresh_token` na primeira ligação). */
function buildAuthorizeUrl(encodedState) {
  const oauth2 = buildOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: oauthScopesEnv(),
    state: encodedState,
  });
}

async function persistRowFromGoogleCredentials(organizationId, tokens, trx) {
  const aad = String(organizationId);
  const refreshPlain = tokens.refresh_token;
  if (!refreshPlain) {
    const err = new Error('google_missing_refresh_token');
    err.statusCode = 400;
    throw err;
  }
  const accessPlain = tokens.access_token;
  if (!accessPlain) {
    const err = new Error('google_missing_access_token');
    err.statusCode = 400;
    throw err;
  }
  const accessCipher = cipher.encrypt(accessPlain, aad);
  const refreshCipher = cipher.encrypt(refreshPlain, aad);

  let tokenExpiresAt = null;
  if (typeof tokens.expiry_date === 'number' && tokens.expiry_date > 0) {
    tokenExpiresAt = new Date(tokens.expiry_date);
  }

  const metadataExtra = {
    scope: tokens.scope || '',
    tokenType: tokens.token_type || 'Bearer',
    lastPersistedAt: new Date().toISOString(),
  };

  let existing =
    trx != null
      ? await IntegrationsGoogleDrive.findOne({
          where: { organizationId },
          transaction: trx,
          lock: trx.UPDATE,
        })
      : await IntegrationsGoogleDrive.findOne({ where: { organizationId } });

  if (!existing) {
    await IntegrationsGoogleDrive.create(
      {
        organizationId,
        accessTokenCipher: accessCipher,
        refreshTokenCipher: refreshCipher,
        tokenExpiresAt,
        oauthMetadata: metadataExtra,
        status: 'active',
      },
      trx ? { transaction: trx } : {},
    );
  } else {
    await existing.update(
      {
        accessTokenCipher: accessCipher,
        refreshTokenCipher: refreshCipher,
        tokenExpiresAt,
        oauthMetadata: { ...(existing.oauthMetadata || {}), ...metadataExtra },
        status: 'active',
      },
      trx ? { transaction: trx } : {},
    );
  }
}

async function persistAfterRefreshTransactional(organizationId, credentialsPayload) {
  await sequelize.transaction(async (trx) => {
    const row = await IntegrationsGoogleDrive.findOne({
      where: { organizationId },
      transaction: trx,
      lock: trx.UPDATE,
    });
    if (!row) {
      throw new Error('google_drive_integration_not_found_mid_refresh');
    }
    await persistRowFromGoogleCredentials(
      organizationId,
      {
        refresh_token:
          credentialsPayload.refresh_token ||
          cipher.decrypt(row.refreshTokenCipher, String(organizationId)),
        access_token: credentialsPayload.access_token,
        expiry_date: credentialsPayload.expiry_date,
        scope: credentialsPayload.scope,
        token_type: credentialsPayload.token_type,
      },
      trx,
    );
  });

  console.info('[google_drive] refreshed tokens persisted (encrypted)', { organizationId });
}

/**
 * Troca `authorization_code` e faz UPSERT cifrado em `integrations_google_drive`.
 */
async function exchangeCodeForTokens(organizationId, code) {
  if (!code || String(code).trim() === '') {
    const err = new Error('missing_authorization_code');
    err.statusCode = 400;
    throw err;
  }
  const oauth2 = buildOAuthClient();
  const tokenResponse = await oauth2.getToken(String(code).trim());
  const { tokens } = tokenResponse;

  if (!tokens.refresh_token) {
    const err = new Error('google_refresh_token_missing_retry_with_consent');
    err.statusCode = 409;
    throw err;
  }

  await sequelize.transaction(async (trx) => {
    await persistRowFromGoogleCredentials(organizationId, tokens, trx);
  });

  console.info('[google_drive] initial OAuth persisted', { organizationId });
}

/** Única saída de access token plaintext para outros módulos (Drive API, jobs…). */

async function getValidGoogleAccessToken(organizationId) {
  const row = await IntegrationsGoogleDrive.findOne({
    where: { organizationId, status: { [Op.ne]: 'revoked' } },
  });
  if (!row || !row.refreshTokenCipher) {
    const err = new Error('google_drive_integration_not_found');
    err.statusCode = 404;
    throw err;
  }

  const aad = String(organizationId);
  const refreshPlain = cipher.decrypt(row.refreshTokenCipher, aad);

  let accessPlain = null;
  if (row.accessTokenCipher) {
    try {
      accessPlain = cipher.decrypt(row.accessTokenCipher, aad);
    } catch (_) {
      accessPlain = null;
    }
  }

  const oauth2 = buildOAuthClient();

  oauth2.setCredentials({
    refresh_token: refreshPlain,
    access_token: accessPlain || undefined,
    expiry_date:
      row.tokenExpiresAt instanceof Date ? row.tokenExpiresAt.getTime() : undefined,
  });

  let expiryCandidate = oauth2.credentials.expiry_date;
  const needsRefresh =
    !expiryCandidate ||
    expiryCandidate <= Date.now() + BUFFER_MS ||
    !accessPlain;
  if (needsRefresh && refreshPlain) {
    const refreshed = await oauth2.refreshAccessToken();
    oauth2.setCredentials(refreshed.credentials);
    await persistAfterRefreshTransactional(organizationId, oauth2.credentials);
  }

  const accessOut = oauth2.credentials.access_token;
  if (!accessOut) {
    const err = new Error('google_no_access_token_available');
    err.statusCode = 500;
    throw err;
  }

  const freshRow = await IntegrationsGoogleDrive.findOne({ where: { organizationId } });

  console.info('[google_drive] internal access issued', {
    organizationId,
    expiry:
      oauth2.credentials.expiry_date != null
        ? new Date(oauth2.credentials.expiry_date).toISOString()
        : null,
  });

  return {
    accessToken: accessOut,
    expiresAt:
      oauth2.credentials.expiry_date != null
        ? new Date(oauth2.credentials.expiry_date)
        : freshRow?.tokenExpiresAt || null,
    oauthMetadata: freshRow?.oauthMetadata || {},
  };
}

async function fetchDriveFileWithBinary(organizationId, googleDriveFileId, options = {}) {
  const { accessToken } = await getValidGoogleAccessToken(organizationId);
  const base = process.env.GOOGLE_DRIVE_API_BASE || 'https://www.googleapis.com/drive/v3';
  const fid = encodeURIComponent(String(googleDriveFileId));

  const maxBytes =
    options.maxBytes != null && Number.isFinite(Number(options.maxBytes)) && Number(options.maxBytes) > 0
      ? Number(options.maxBytes)
      : null;

  const metaResp = await axios.get(`${base}/files/${fid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { fields: 'name,mimeType,size,id' },
    timeout: Number(process.env.GOOGLE_DRIVE_META_TIMEOUT_MS || 120000),
    validateStatus: (status) => status === 200,
  });

  const sizeKnown =
    metaResp.data?.size != null && `${metaResp.data.size}`.trim() !== ''
      ? Number(metaResp.data.size)
      : null;
  if (
    maxBytes != null &&
    sizeKnown != null &&
    Number.isFinite(sizeKnown) &&
    sizeKnown > maxBytes
  ) {
    const err = new Error('drive_file_exceeds_plan_max_size');
    err.statusCode = 413;
    err.bytesKnown = sizeKnown;
    err.maxBytes = maxBytes;
    throw err;
  }

  const mediaResp = await axios.get(`${base}/files/${fid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { alt: 'media' },
    responseType: 'arraybuffer',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: Number(process.env.GOOGLE_DRIVE_DOWNLOAD_TIMEOUT_MS || 900000),
    validateStatus: (status) => status === 200,
  });

  const buffer = Buffer.from(mediaResp.data);
  const mimeType = metaResp.data?.mimeType || 'video/mp4';
  const fileName = metaResp.data?.name || String(googleDriveFileId);

  return { buffer, mimeType, fileName, sizeKnown: metaResp.data?.size || null };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getValidGoogleAccessToken,
  getValidToken: getValidGoogleAccessToken,
  fetchDriveFileWithBinary,
};
