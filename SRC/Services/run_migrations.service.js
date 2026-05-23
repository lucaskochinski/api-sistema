'use strict';

const path = require('path');
const { Sequelize } = require('sequelize');
const Umzug = require('umzug');

/**
 * Aplica migrações Sequelize pendentes (idempotente).
 * @param {import('sequelize').Sequelize} sequelize
 */
async function runPendingMigrations(sequelize) {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT || 'true').toLowerCase() === 'false') {
    console.info('[migrations] ignorado (RUN_MIGRATIONS_ON_BOOT=false)');
    return { applied: 0, skipped: true };
  }

  const umzug = new Umzug({
    migrations: {
      path: path.join(__dirname, '..', 'migrations'),
      params: [sequelize.getQueryInterface(), Sequelize],
    },
    storage: 'sequelize',
    storageOptions: { sequelize },
    logging: (msg) => console.info(`[migrations] ${msg}`),
  });

  const pending = await umzug.pending();
  if (!pending.length) {
    console.info('[migrations] schema actualizado — nenhuma pendente');
    return { applied: 0 };
  }

  const names = pending.map((m) => m.file || m.name || m);
  console.info(`[migrations] aplicando ${pending.length} migração(ões):`, names.join(', '));
  const executed = await umzug.up();
  console.info(`[migrations] ${executed.length} migração(ões) aplicada(s) com sucesso`);
  return { applied: executed.length };
}

module.exports = { runPendingMigrations };
