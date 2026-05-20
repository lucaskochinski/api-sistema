'use strict';

const { Sequelize } = require('sequelize');
const configs = require('./database.config');

const envName = process.env.NODE_ENV || 'development';
const cfg = configs[envName] || configs.development;

const common = {
  dialect: cfg.dialect,
  dialectOptions: cfg.dialectOptions,
  logging: cfg.logging,
  define: cfg.define,
  pool: cfg.pool,
};

const sequelize = cfg.url
  ? new Sequelize(cfg.url, common)
  : new Sequelize(cfg.database, cfg.username, cfg.password || '', {
      ...common,
      host: cfg.host,
      port: cfg.port,
    });

module.exports = sequelize;
