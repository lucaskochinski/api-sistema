'use strict';

const IORedis = require('ioredis');

/** BullMQ precisa desta flag no cliente ioredis. */
function redisOptionsExtra() {
  return { maxRetriesPerRequest: null, enableReadyCheck: false };
}

/**
 * Nova conexão IORedis (use uma instância por Queue / Worker conforme recomendações BullMQ em produção).
 */
function createBullMqConnection() {
  const url = process.env.REDIS_URL;
  if (url && url.trim()) {
    return new IORedis(url.trim(), redisOptionsExtra());
  }
  return new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls:
      process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true' ? {} : undefined,
    ...redisOptionsExtra(),
  });
}

module.exports = { createBullMqConnection };
