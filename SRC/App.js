'use strict';

const express = require('express');
const cors = require('cors');
const { ValidationError, UniqueConstraintError } = require('sequelize');
const db = require('./Models');
const apiRoutes = require('./Routes');
const billingStripeWebhook = require('./Features/Billing/billing.http');
const { bootstrapDatabase } = require('./bootstrapDatabase.service');
const { ensureDailySyncScheduleOnBoot } = require('./Services/daily_sync.scheduler.service');

/** Nunca usar sequelize.sync() — schema exclusivamente via migrações. */

const app = express();
app.disable('x-powered-by');

/** CORS para SPA em outro host (`CORS_ORIGINS` separado por vírgula). Sem lista: dev = reflete origem; produção = desliga CORS aberto. */
const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : nodeEnv !== 'production',
    credentials: String(process.env.CORS_CREDENTIALS || 'true').toLowerCase() === 'true',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    maxAge: 86400,
  }),
);
if (nodeEnv === 'production' && corsOrigins.length === 0) {
  console.warn(
    '[cors] CORS_ORIGINS vazio em produção: defina origens explícitas ou sirva o front pelo mesmo domínio / proxy.',
  );
}

/** Body bruto obrigatório para `stripe.webhooks.constructEvent(...)`. */
app.post(
  '/api/webhooks/stripe',
  express.raw({
    type: 'application/json',
    limit: String(process.env.STRIPE_WEBHOOK_BODY_LIMIT || '8mb'),
  }),
  billingStripeWebhook.stripeWebhook,
);

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hooko-api' });
});

app.use('/api', apiRoutes);

app.use((_req, _res, next) => {
  const err = new Error('not_found');
  err.statusCode = 404;
  next(err);
});

/** Tratamento global: status em `err.statusCode`, quota em `err.quotaHint`, Sequelize ORM. */
app.use((err, _req, res, _next) => {
  let status = 500;
  if (err instanceof ValidationError) {
    status = 400;
  } else if (err instanceof UniqueConstraintError) {
    status = 409;
  } else if (err.statusCode && Number(err.statusCode) >= 400 && Number(err.statusCode) < 600) {
    status = Number(err.statusCode);
  }

  if (status >= 500) {
    console.error(err);
  }

  const payload = {
    message: status >= 500 ? 'unexpected_error' : err.message || 'error',
  };
  if (err.quotaHint && typeof err.quotaHint === 'object') payload.quota = err.quotaHint;
  res.status(status).json(payload);
});

const port = Number(process.env.PORT || 3000);

async function bootstrap() {
  await db.sequelize.authenticate();

  await bootstrapDatabase().catch((e) => {
    console.warn('[bootstrapDatabase] falhou (migrate / DB?):', e?.message || e);
  });

  await ensureDailySyncScheduleOnBoot();

  await new Promise((resolve, reject) => {
    const server = app.listen(port, (listenErr) => {
      if (listenErr) reject(listenErr);
      else resolve();
    });
    server.once('error', reject);
  });
  console.info(`HOOKO API listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error('HOOKO API bootstrap FAILED.', error.message);
  process.exit(1);
});
