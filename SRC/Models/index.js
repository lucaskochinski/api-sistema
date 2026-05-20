'use strict';

const Sequelize = require('sequelize');
const sequelize = require('../Config/database');

const db = {
  sequelize,
  Sequelize,
};

const modelFactories = [
  require('./organization'),
  require('./user'),
  require('./membership'),
  require('./role'),
  require('./permission'),
  require('./role_permission'),
  require('./membership_role'),
  require('./integrations_meta'),
  require('./integrations_google_drive'),
  require('./meta_ad_account'),
  require('./campaign'),
  require('./ad_set'),
  require('./ad'),
  require('./media_asset'),
  require('./organization_media_claim'),
  require('./creative_analysis'),
  require('./ad_performance_daily'),
  require('./plan'),
  require('./subscription'),
  require('./invoice'),
  require('./webhook_event_log'),
  require('./payment_transaction'),
  require('./usage_counter'),
  require('./system_setting'),
  require('./external_sale'),
];

modelFactories.forEach((factory) => {
  const model = factory(sequelize, Sequelize.DataTypes);
  db[model.name] = model;
});

Object.keys(db).forEach((key) => {
  if (key === 'sequelize' || key === 'Sequelize') return;
  const model = db[key];
  if (model?.associate) {
    model.associate(db);
  }
});

module.exports = db;
