'use strict';

/**
 * Rastreamento leve das ações do painel (console estruturado).
 * Persistência em audit table poderá substituir este helper posteriormente.
 */
function adminAudit(actorUserId, action, payload = {}) {
  const line = {
    ts: new Date().toISOString(),
    actorUserId: actorUserId || null,
    action,
    payload,
  };
  console.info('[admin_audit]', JSON.stringify(line));
}

module.exports = {
  adminAudit,
};
