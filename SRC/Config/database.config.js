'use strict';

/**
 * Configuração compatível com `sequelize-cli` (`db:migrate`, `db:seed:all`).
 * Variáveis: `HOOKO_DATABASE_URL` ou `DATABASE_URL`, ou trio `PGUSER`/`PGDATABASE`/etc.
 */

function postgresDialectOptions() {
  if (process.env.PG_SSL !== 'true') return {};
  return { ssl: { rejectUnauthorized: true } };
}

function connectionFromEnv() {
  const explicitUrl =
    process.env.HOOKO_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (explicitUrl) {
    return { url: explicitUrl };
  }
  const database = process.env.PGDATABASE || process.env.DB_NAME || 'hooko_dev';
  const username = process.env.PGUSER || process.env.DB_USER || process.env.USER || 'postgres';
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || '';
  const host = process.env.PGHOST || process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || process.env.DB_PORT || 5432);
  return { database, username, password, host, port };
}

function build(envName) {
  const dialect = 'postgres';
  const dialectOptions = postgresDialectOptions();
  const conn = connectionFromEnv();
  const logging =
    envName !== 'production' && process.env.SEQUELIZE_LOGGING === '1' ? console.log : false;

  return {
    env: envName,
    dialect,
    dialectOptions,
    logging,
    define: { underscored: true },
    pool: {
      max: Number(process.env.PGPOOL_MAX || 10),
      min: Number(process.env.PGPOOL_MIN || 0),
      idle: Number(process.env.PGPOOL_IDLE_MS || 10000),
      acquire: Number(process.env.PGPOOL_ACQUIRE_MS || 60000),
    },
    ...(conn.url
      ? { url: conn.url }
      : {
          database: conn.database,
          username: conn.username,
          password: conn.password,
          host: conn.host,
          port: conn.port,
        }),
  };
}

module.exports = {
  development: build('development'),
  test: build('test'),
  production: build('production'),
};
