'use strict';

const Sequelize = require('sequelize');

const coercePagination = (queryLike = {}) => {
  const limit = Math.min(100, Math.max(1, Number(queryLike.limit) || 20));
  const offset = Math.max(0, Number(queryLike.offset) || 0);
  return { limit, offset };
};

const coerceSearch = (queryLike = {}) => {
  const q = String(queryLike.search || '').trim();
  return q.length > 160 ? q.slice(0, 160) : q;
};

module.exports = {
  coercePagination,
  coerceSearch,
};
