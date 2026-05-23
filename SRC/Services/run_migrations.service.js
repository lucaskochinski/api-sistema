'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const META_TABLE = 'SequelizeMeta';

/** Se o schema já reflecte a migração (BD criada via sync), marca como aplicada sem re-executar. */
const ALREADY_APPLIED = {
  '20260511140000-init-hooko-schema-with-billing-observability.js': (sequelize) =>
    tableExists(sequelize, 'organizations'),
  '20260511150000-system-settings-plan-trial.js': (sequelize) =>
    columnExists(sequelize, 'plans', 'trial_days'),
  '20260511160000-add-google-drive-access-token-columns.js': (sequelize) =>
    columnExists(sequelize, 'integrations_google_drive', 'access_token_cipher'),
  '20260512103000-seed-auth-roles.js': (sequelize) => roleKeyExists(sequelize, 'hooko_platform_admin'),
  '20260512144500-metasync-schema-columns.js': (sequelize) =>
    columnExists(sequelize, 'ads', 'meta_video_id'),
  '20260515120000-standardize-plan-limits-jsonb.js': (sequelize) => tableExists(sequelize, 'plans'),
  '20260516120000-plan-is-public-custom-org.js': (sequelize) =>
    columnExists(sequelize, 'plans', 'is_public'),
  '20260517120000-add-ads-creative-copy-columns.js': (sequelize) =>
    columnExists(sequelize, 'ads', 'primary_text'),
  '20260517121500-canonical-plan-limits-creative-imports.js': (sequelize) =>
    tableExists(sequelize, 'plans'),
  '20260522120000-plan-price-amount-stripe-product.js': (sequelize) =>
    columnExists(sequelize, 'plans', 'stripe_product_id'),
};

async function tableExists(sequelize, table) {
  const [rows] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = :table
     ) AS exists`,
    { replacements: { table } },
  );
  return Boolean(rows[0]?.exists);
}

async function columnExists(sequelize, table, column) {
  const [rows] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = :table AND column_name = :column
     ) AS exists`,
    { replacements: { table, column } },
  );
  return Boolean(rows[0]?.exists);
}

async function roleKeyExists(sequelize, key) {
  const [rows] = await sequelize.query(`SELECT 1 FROM roles WHERE key = :key LIMIT 1`, {
    replacements: { key },
  });
  return rows.length > 0;
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+[\w-]+\.js$/.test(f))
    .sort();
}

async function ensureSequelizeMetaTable(sequelize) {
  await sequelize
    .getQueryInterface()
    .createTable(META_TABLE, {
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
      },
    })
    .catch(() => {});
}

async function getExecutedMigrationNames(sequelize) {
  await ensureSequelizeMetaTable(sequelize);
  const [rows] = await sequelize.query(`SELECT name FROM "${META_TABLE}" ORDER BY name`);
  return rows.map((r) => r.name);
}

async function recordMigrationName(sequelize, name) {
  await ensureSequelizeMetaTable(sequelize);
  await sequelize.query(
    `INSERT INTO "${META_TABLE}" (name) VALUES (:name) ON CONFLICT (name) DO NOTHING`,
    { replacements: { name } },
  );
}

async function runMigrationFile(sequelize, file) {
  const migrationPath = path.join(MIGRATIONS_DIR, file);
  delete require.cache[require.resolve(migrationPath)];
  const mod = require(migrationPath);
  const up = typeof mod.up === 'function' ? mod.up : mod.default?.up;
  if (typeof up !== 'function') {
    throw new Error(`migration_missing_up:${file}`);
  }
  await up(sequelize.getQueryInterface(), Sequelize);
}

/**
 * Baseline + aplicação directa (sem Umzug — evita tabela meta divergente SequelizeMeta vs SequelizeMetas).
 * @param {import('sequelize').Sequelize} sequelize
 */
async function runPendingMigrations(sequelize) {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT || 'true').toLowerCase() === 'false') {
    console.info('[migrations] ignorado (RUN_MIGRATIONS_ON_BOOT=false)');
    return { applied: 0, baselined: 0, skipped: true };
  }

  await ensureSequelizeMetaTable(sequelize);
  const executedSet = new Set(await getExecutedMigrationNames(sequelize));
  const files = listMigrationFiles();
  let baselined = 0;
  let applied = 0;

  for (const file of files) {
    if (executedSet.has(file)) continue;

    const checker = ALREADY_APPLIED[file];
    if (!checker) {
      console.warn(`[migrations] sem baseline para ${file}`);
      break;
    }

    if (!(await checker(sequelize))) {
      console.info(`[migrations] pendente real: ${file}`);
      break;
    }

    await recordMigrationName(sequelize, file);
    executedSet.add(file);
    baselined += 1;
    console.info(`[migrations] baseline (schema já presente): ${file}`);
  }

  if (baselined > 0) {
    console.info(`[migrations] ${baselined} migração(ões) registada(s) via baseline`);
  }

  for (const file of files) {
    if (executedSet.has(file)) continue;

    console.info(`[migrations] aplicando: ${file}`);
    await runMigrationFile(sequelize, file);
    await recordMigrationName(sequelize, file);
    executedSet.add(file);
    applied += 1;
    console.info(`[migrations] concluída: ${file}`);
  }

  if (applied === 0 && baselined === 0) {
    console.info('[migrations] schema actualizado — nenhuma pendente');
  } else if (applied > 0) {
    console.info(`[migrations] ${applied} migração(ões) aplicada(s) com sucesso`);
  }

  return { applied, baselined };
}

module.exports = { runPendingMigrations };
