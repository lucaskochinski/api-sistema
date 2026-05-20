'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTE_LENGTH = 12;
/** Auth tag length padrão GCM Node (16 bytes) */
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = '1';

function loadEncryptionKeyBuffer() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (hex && /^[a-fA-F0-9]{64}$/.test(hex.trim())) {
    return Buffer.from(hex.trim(), 'hex');
  }
  const b64 = process.env.TOKEN_ENCRYPTION_KEY_BASE64;
  if (b64 && b64.trim().length > 0) {
    const buf = Buffer.from(b64.trim(), 'base64');
    if (buf.length === KEY_BYTES) return buf;
  }
  throw new Error(
    'Defina TOKEN_ENCRYPTION_KEY (64 caracteres hex = 32 bytes) ou TOKEN_ENCRYPTION_KEY_BASE64 (32 bytes após decode).',
  );
}

let cachedKey;

function encryptionKey() {
  if (!cachedKey) cachedKey = loadEncryptionKeyBuffer();
  return cachedKey;
}

/**
 * Divide envelope `version:iv:tag:ciphertext_hex` onde ciphertext é hex (sem ':' internos).
 * @param {string} envelope
 */
function splitEnvelope(envelope) {
  const idxV = envelope.indexOf(':');
  const idxIv = envelope.indexOf(':', idxV + 1);
  const idxTag = envelope.indexOf(':', idxIv + 1);
  if (idxV < 0 || idxIv < 0 || idxTag < 0) {
    throw new Error('invalid_cipher_envelope');
  }
  const version = envelope.slice(0, idxV);
  const ivHex = envelope.slice(idxV + 1, idxIv);
  const authTagHex = envelope.slice(idxIv + 1, idxTag);
  const cipherHex = envelope.slice(idxTag + 1);
  if (!ivHex || !authTagHex || !cipherHex) throw new Error('invalid_cipher_envelope');
  return { version, ivHex, authTagHex, cipherHex };
}

/**
 * Cifragem AES-256-GCM. Recomende-se sempre `aad` = `organizationId` para binding ao tenant.
 * @param {string} plaintext
 * @param {string} [aad]
 * @returns {string}
 */
function encrypt(plaintext, aad = '') {
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * @param {string} envelope
 * @param {string} [aad]
 * @returns {string}
 */
function decrypt(envelope, aad = '') {
  const { version, ivHex, authTagHex, cipherHex } = splitEnvelope(String(envelope));
  if (version !== FORMAT_VERSION) throw new Error('unsupported_cipher_version');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = {
  encrypt,
  decrypt,
};
