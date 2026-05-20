'use strict';

function toBase64Url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 2) s += '==';
  else if (pad === 3) s += '=';
  else if (pad === 1) throw new Error('invalid_oauth_state_encoding');
  return Buffer.from(s, 'base64');
}

/** State OAuth compacto `{ organizationId }` para parâmetro `state=`. */
function encodeOrganizationState(organizationId) {
  const payload = JSON.stringify({ organizationId: String(organizationId) });
  return toBase64Url(Buffer.from(payload, 'utf8'));
}

/** @throws {Error} quando state inválido */
function decodeOrganizationState(encoded) {
  if (!encoded || String(encoded).trim() === '') {
    throw new Error('missing_oauth_state');
  }
  let json;
  try {
    json = fromBase64Url(String(encoded)).toString('utf8');
  } catch (_) {
    throw new Error('invalid_oauth_state_encoding');
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (_) {
    throw new Error('invalid_oauth_state_json');
  }
  if (!parsed.organizationId) {
    throw new Error('invalid_oauth_state_payload');
  }
  return { organizationId: String(parsed.organizationId) };
}

module.exports = {
  encodeOrganizationState,
  decodeOrganizationState,
};
