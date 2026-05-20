# Relatório de entrega MVP — HOOKO API  
**Auditoria Lead + Handoff Front-end / DevOps**

Documento gerado contra o código em `hooko--api/`. Cobre conformidade ao escopo acordado, mapa completo da API e pontos críticos (CORS, erros globais, quotas).

---

## Resumo executivo

| Área | Status |
|------|--------|
| Postgres + Sequelize + migrações + multi-tenant (UUID/`organizationId`) | **OK** — modelagem e migrações no repositório. |
| JWT + RBAC + resolução de tenant nos controllers (`organizationId` + membership) | **OK** — `authMiddleware`; admin usa `requireJwtRole`. |
| Auto-seed super admin (`App.js`) | **OK** — `bootstrapDatabase()` após `authenticate()`. |
| OAuth Meta / Google Drive + tokens cifrados | **OK** — `authorize-url` exige **JWT** + `organizationId` na membership; callbacks públicos (`state` + código). |
| MetaSync live + importação por **criativo/anúncio** com quotas + re-sync bypass créditos | **OK** — `metasync.service.js` (`listLiveAdsByCampaign`, `importAndAnalyzeAd`). |
| Workers BullMQ (vídeo + daily sync) + limites de plano + bypass platform admin | **OK** |
| Dashboard overview / insights / campanhas importadas | **OK** |
| Admin (users, settings/cron, planos) | **OK** |
| Billing Stripe (checkout trial, custom org, portal, webhook raw) | **OK** |
| Cron diário BullMQ `ad_performance_daily` | **OK** — worker `worker:daily-sync`. |
| **CORS** | **Corrigido nesta auditoria** — pacote `cors` + `CORS_ORIGINS`. |
| **404 + erros ORM** | **Corrigido nesta auditoria** — handler `not_found` + `ValidationError`/`UniqueConstraintError`. |
| **Renovação mensal `usage_counters`** | **Já coberto por desenho** — sem job separado (vide BLOCO 2). |

---

## BLOCO 1 — Mapa da API (Front-end)

Convenção: base **`/api`** exceto **`/health`** e webhook Stripe.  
**JWT** = header `Authorization: Bearer <token>`.  
**Role admin** = papel `hooko_platform_admin` (ou `PLATFORM_ADMIN_JWT_ROLE_KEY`).

| Método | Endpoint | Autenticação / papel |
|--------|----------|----------------------|
| **App (raiz)** | | |
| `GET` | `/health` | Público |
| `POST` | `/api/webhooks/stripe` | Público (Stripe assina o body; **não** usar JSON parser antes — já registrado com `express.raw` em `App.js`) |
| **Plans** | | |
| `GET` | `/api/plans/public` | Público — vitrine landing (`is_active` + `is_public`) |
| **Auth** | | |
| `POST` | `/api/auth/login` | Público |
| `POST` | `/api/auth/register` | Público |
| `GET` | `/api/auth/me` | **JWT** |
| **User (tenant-scope)** | | |
| `GET` | `/api/users` | **JWT** — lista apenas usuários com membership ativa nas **mesmas organizações** do token (isolamento tenant). Sem `memberships` ativas → `[]`. |
| `GET` | `/api/users/_meta/stats` | **JWT** — `{ ok, totalUsers, scopeOrganizationCount }` para o mesmo escopo tenant. |
| **Meta OAuth** | | |
| `GET` | `/api/meta/oauth/authorize-url` | **JWT** — query `organizationId` deve pertencer ao usuário (**403** caso contrário); `state` assinado. |
| `GET` | `/api/meta/oauth/callback` | **Público** (redirect Meta; segurança via `state`). |
| `POST` | `/api/meta/oauth/callback` | **Público** (testes / fallback body). |
| **Google Drive OAuth** | | |
| `GET` | `/api/google-drive/oauth/authorize-url` | **JWT** — idem Meta (`organizationId` na membership). |
| `GET` | `/api/google-drive/oauth/callback` | **Público**. |
| `POST` | `/api/google-drive/oauth/callback` | **Público**. |
| **MetaSync** | | |
| `GET` | `/api/metasync/account/:metaActId/live-campaigns` | **JWT** — passo 1 (navegação); `organizationId` se multi-tenant; opcional `includeQuota=true` |
| `GET` | `/api/metasync/account/:metaActId/campaign/:metaCampaignId/live-ads` | **JWT** — passo 2: anúncios da campanha + `is_imported`; idem `organizationId` / `includeQuota` |
| `POST` | `/api/metasync/account/:metaActId/campaign/:metaCampaignId/ad/:metaAdId/import` | **JWT** — body: `metaActId`, `organizationId` se multi-tenant; opcional `insightsSince` / `insightsUntil` — **1 crédito de criativo** por ad novo |
| **Media** | | |
| `POST` | `/api/media/:mediaId/analyze` | **JWT** |
| **Dashboard** | | |
| `GET` | `/api/dashboard/overview` | **JWT** — `organizationId` se necessário |
| `GET` | `/api/dashboard/insights` | **JWT** |
| `GET` | `/api/dashboard/imported-campaigns` | **JWT** |
| **Billing** | | |
| `POST` | `/api/billing/checkout` | **JWT** — body `planId`, `organizationId` opcional, `billingEmail`/`billingName` opcionais |
| `POST` | `/api/billing/portal` | **JWT** |
| **Admin** (todas **JWT + role admin**) | | |
| `GET` | `/api/admin/finance/subscriptions` | **JWT + admin** |
| `GET` | `/api/admin/finance/invoices` | **JWT + admin** |
| `GET` | `/api/admin/finance/summary` | **JWT + admin** |
| `POST` | `/api/admin/plans` | **JWT + admin** |
| `GET` | `/api/admin/settings` | **JWT + admin** |
| `PUT` | `/api/admin/settings` | **JWT + admin** |
| `GET` | `/api/admin/metrics/overview` | **JWT + admin** |
| `GET` | `/api/admin/metrics/webhooks` | **JWT + admin** |
| `GET` | `/api/admin/organizations` | **JWT + admin** |
| `GET` | `/api/admin/organizations/:organizationId` | **JWT + admin** |
| `GET` | `/api/admin/users` | **JWT + admin** |
| `POST` | `/api/admin/users` | **JWT + admin** |
| `GET` | `/api/admin/users/:userId` | **JWT + admin** |

**Padrão multi-tenant (front):** quando o usuário tem mais de uma membership, enviar **`organizationId`** em query (GET) ou body conforme o endpoint; caso contrário a API usa a única org do JWT.

---

## BLOCO 2 — Pontas soltas e análise crítica

### 1) CORS

- **Situação anterior:** não havia `cors` em `App.js` — browser em origem diferente da API falharia em chamadas cross-origin.
- **Correção aplicada:** `cors` middleware com `CORS_ORIGINS` (lista separada por vírgula), `CORS_CREDENTIALS` (default `true`), preflight `OPTIONS`. Em **produção**, sem `CORS_ORIGINS`, o pacote `cors` fica com `origin: false` (comportamento restritivo) e um **warning** é logado no boot.

### 2) Tratamento global de erros

- **Situação anterior:** existia um handler que lia `err.statusCode`, mas **sem** rota 404 explícita e **sem** mapear erros comuns do Sequelize.
- **Correção aplicada:**
  - Middleware final **`not_found`** → `404` + `not_found`.
  - Handler global trata **`Sequelize.ValidationError`** → `400` e **`UniqueConstraintError`** → `409`, além de `statusCode` explícito e `quota` em `err.quotaHint`.
- **Observação:** rotas `async` continuam responsáveis por `try/catch` + `next(err)`; rotas sem isso podem gerar *unhandled rejection* (recomendação futura: wrapper `asyncHandler`).

### 3) Renovação mensal de `usage_counters`

- **Não depende de webhook Stripe nem de cron de “reset”.**
- O modelo usa chave única **`(organizationId, metricKey, periodLabel)`** com **`periodLabel` = `YYYY-MM` em UTC** (`monthlyPeriodLabelUtc()` em `transcription_usage.service.js` e `metasync.service.js`).
- No **primeiro uso do mês**, o código **cria uma nova linha** com o novo `periodLabel`; o contador do mês anterior permanece no histórico (útil para auditoria).
- **Limites do plano** vêm de `plans.limits` + assinatura ativa/trialing (`plan_limits.service.js`); mudança de plano/ciclo de faturamento **não** é automaticamente “alinhada” a um job de reset de contador — o que importa para o MVP é que **cada mês civil UTC** começa com **uso 0** na linha nova.

### 4) Variáveis de ambiente

- **Arquivo consolidado:** [`.env.example`](../../.env.example) na raiz do pacote `hooko--api` (template com todas as chaves encontradas no código para subir API + workers + Stripe + OAuth + filas).

### 5) Superfícies públicas remanescentes (esperadas)

| Superfície | Motivo |
|------------|--------|
| `GET /health` | Health-check load balancer |
| `POST /api/webhooks/stripe` | Assinatura HMAC Stripe (sem JWT). |
| `POST /api/auth/login`, `/register` | Autenticação. |
| `GET /api/plans/public` | Vitrine de planos. |
| **`GET|POST …/oauth/callback` (Meta e Google)** | Redirect do provider **não** envia `Authorization`; mitigação = **`state`** + troca segura do `code`. |
| **`POST …/oauth/callback` só com `{ organizationId, code }`** (sem `state`) | Útil em testes; em produção preferir sempre fluxo com `state` no GET. |

Outros endpoints sensíveis exigem **JWT** e, onde aplicável, **membresia na `organizationId`**.

### 6) Observações de produto (não são falhas de implementação)

| Tema | Nota |
|------|------|
| **Alinhamento faturamento Stripe ↔ `periodLabel` em quotas** | Quotas são **calendário UTC** (`YYYY-MM`), não ciclo de faturamento Stripe. |

---

## DevOps — checklist rápido

1. **Postgres:** `HOOKO_DATABASE_URL` ou variáveis `PG*`; `npm run migrate` (ou `start` que migra antes do `node`).
2. **Redis:** obrigatório para BullMQ (workers vídeo + daily sync + scheduler na API).
3. **Processos:**
   - API: `node SRC/App.js` ou `npm start`.
   - Worker vídeo: `npm run worker:video`.
   - Worker métricas diárias: `npm run worker:daily-sync`.
4. **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, URL pública em `CORS_ORIGINS` + `PUBLIC_APP_URL`; webhook apontando para `POST /api/webhooks/stripe`.
5. **Produção:** definir **`CORS_ORIGINS`** explicitamente e fortalecer **`JWT_SECRET`**.

---

## Referências de código

- Entrada HTTP: [`SRC/App.js`](../App.js)
- Rotas agregadas: [`SRC/Routes/index.js`](../Routes/index.js)
- Seed / bootstrap: [`SRC/bootstrapDatabase.service.js`](../bootstrapDatabase.service.js)
- Template env: [`.env.example`](../../.env.example)
