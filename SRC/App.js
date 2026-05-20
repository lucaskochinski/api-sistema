'use strict';

const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const { ValidationError, UniqueConstraintError } = require('sequelize');
const db = require('./Models');
const apiRoutes = require('./Routes');
const billingStripeWebhook = require('./Features/Billing/billing.http');
const { bootstrapDatabase } = require('./bootstrapDatabase.service');
const { ensureDailySyncScheduleOnBoot } = require('./Services/daily_sync.scheduler.service');

/**
 * Auto-inicialização idempotente do usuário Super Admin principal solicitado.
 */
async function initializeAdmin() {
  try {
    const email = 'adminpatrick@gmail.com';
    const password = 'adminpatrick';
    const roleKey = process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin';

    const existingUser = await db.User.scope(null).findOne({ where: { email } });
    if (existingUser) {
      console.info('Admin default já existe');
      return;
    }

    const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
    const passwordHash = await bcrypt.hash(password, rounds);
    
    const newUser = await db.User.create({
      email,
      passwordHash,
    });

    const orgSlug = process.env.SEED_SUPER_ADMIN_ORG_SLUG || 'hooko-admin';
    const orgName = process.env.SEED_SUPER_ADMIN_ORG_NAME || 'HOOKO Admin';
    const [orgInst] = await db.Organization.findOrCreate({
      where: { slug: orgSlug },
      defaults: {
        name: orgName,
        slug: orgSlug,
      },
    });

    const [mShip] = await db.Membership.findOrCreate({
      where: { organizationId: orgInst.id, userId: newUser.id },
      defaults: {
        organizationId: orgInst.id,
        userId: newUser.id,
        status: 'active',
      },
    });

    const platformRole = await db.Role.findOne({ where: { key: roleKey } });
    if (platformRole) {
      await db.MembershipRole.findOrCreate({
        where: {
          membershipId: mShip.id,
          roleId: platformRole.id,
        },
        defaults: {
          membershipId: mShip.id,
          roleId: platformRole.id,
        },
      });
    }

    console.info('Admin default inicializado com sucesso');
  } catch (error) {
    console.error('⚠️ [initializeAdmin] Falha ao auto-inicializar admin patrick:', error?.message || error);
  }
}

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

  // Permite recriar forçadamente todas as tabelas a partir dos Models em deploys limpos
  if (String(process.env.DB_FORCE_SYNC || '').toLowerCase() === 'true') {
    console.info('🔄 [DB_FORCE_SYNC] Dropando e recriando todas as tabelas do banco de dados...');
    await db.sequelize.sync({ force: true });
    console.info('✅ [DB_FORCE_SYNC] Todas as tabelas foram recriadas com sucesso!');
  }

  await bootstrapDatabase().catch((e) => {
    console.warn('[bootstrapDatabase] falhou (migrate / DB?):', e?.message || e);
  });

  await initializeAdmin().catch((e) => {
    console.warn('[initializeAdmin] falhou:', e?.message || e);
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
