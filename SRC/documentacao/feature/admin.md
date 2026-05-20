# Feature **Admin — painel SaaS (controle central)**

Painel só para **`hooko_platform_admin`** no JWT (ou chave configurada por **`PLATFORM_ADMIN_JWT_ROLE_KEY`**). Todas as rotas passam **`authMiddleware`** + **`requireJwtRole(...)`**.

## Estrutura de pastas (obrigatória)

Raiz **`SRC/Features/Admin/`**:

| Pasta / arquivo | Conteúdo |
|-----------------|----------|
| `admin.routes.js` | Router Express montado como `/api/admin`. |
| `controllers/` | Thin controllers HTTP. |
| `services/` | Agregações globais Sequelize (multi-tenant, sem escopo `organization_id` único). |
| `helpers/adminAudit.helper.js` | Logs estruturados `[admin_audit]` (evoluível para auditoria persistente). |
| `helpers/coerceBody.util.js` | Helpers de parsing (`limit`/`offset`/`search`). |

Montagem da API em [`SRC/Routes/index.js`](../Routes/index.js):

```javascript
router.use('/admin', adminRoutes);
```

## Autorização

1. **`Authorization: Bearer <JWT>`** válido (**`JWT_SECRET`**).
2. Array **`roles`** no JWT deve incluir **`hooko_platform_admin`** por padrão (ver [auth.md](./auth.md)).

`403` quando o token é válido mas falta o papel.

## Auditoria (`adminAudit.helper`)

Antes ou depois de operações administrativas, os controllers gravam **`[admin_audit]`** no stdout com **`actorUserId`**, **`action`** (nome estável tipo `admin.users.list`) e payload mínimo (paginação, ids). Substitua por tabela própria se precisar de trilha imutável.

## Endpoints `/api/admin/*`

Prefixo sempre **`/api/admin`**.

### Settings (cron / config global)

Persistência na tabela **`system_settings`** (chave única `"key"`, **`value`** JSON).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/settings` | Mapa atual `{ "SETTING_KEY": valor }`. Ex.: `DAILY_SYNC_TIME` vale `{ "time": "02:30" }` (**UTC**) para métricas do dia anterior via BullMQ. |
| `PUT` | `/settings` | PATCH: objeto plano **`{ CHAVE: valor }`** ou **`{ settings: { … } }`**. Ao alterar **`DAILY_SYNC_TIME`**, o servidor remove repeatable jobs antigos e agenda novo horário (**`rescheduleDailyMetaInsightsSync`**). Falha Redis/fila ao reagendar → **`503`** `daily_sync_reschedule_failed`. Worker: **`npm run worker:daily-sync`**. |

Código em [`controllers/admin.settings.controller`](../../Features/Admin/controllers/admin.settings.controller.js) e scheduler em [`Services/daily_sync.scheduler.service`](../../Services/daily_sync.scheduler.service.js).

### Finanças (Stripe/alto nível DB)

| Método | Caminho | Query | Serviço |
|--------|---------|-------|---------|
| `GET` | `/finance/subscriptions` | `limit`, `offset` | Lista assinaturas + org + plano. |
| `GET` | `/finance/invoices` | `limit`, `offset`, `status?` | Faturas com org e subscription. |
| `GET` | `/finance/summary` | — | Agrupamentos por status de subscription + soma **`amount_due_cents`** de faturas abertas. |
| `POST` | `/plans` | — | Cadastro Super Admin do catálogo: **`tier_key`**, **`name`**, **`stripe_price_id`**, opcional **`limits`** (JSON), **`trial_days`** (default 0, máx. 730), **`is_public`** (default **`true`** — landing `GET /api/plans/public` quando **`is_active`**), **`custom_organization_id`** opcional (**plano exclusivo** do tenant — checkout validado na Billing API). **`409`** se **`tier_key`** duplicado. |

### Métricas

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/metrics/overview` | Contagens globais: orgs, usuários, memberships ativas, análises IA (`creative_analyses`), vídeos (pipeline/processados/`processed`), rollup **`usage_counters`**. |
| `GET` | `/metrics/webhooks` | Lista recente problemática (**`dead_letter`/`queued`**) em `webhook_event_logs`; buckets por `processing_status`. |

### Organizations (tenants)

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/organizations` | `limit`, `offset`, `search` (nome/slug ILIKE). Inclui últimas subscriptions (até 5). |
| `GET` | `/organizations/:organizationId` | Detalhe com subscriptions (todas nesta associação), memberships resumidas, últimas faturas. |

### Users

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/users` | `limit`, `offset`, `search` (email). Memberships + roles + org. Sem expor **`password_hash`**. |
| `POST` | `/users` | `email`, `password` (mínimo 8 para novo usuário; se o e‑mail já existe e senha for enviada com ≥8, atualiza hash), `organizationId`, `roleKeys` (lista ou CSV), opcionalmente `membershipStatus` (`active`,`invited`,`suspended`). |
| `GET` | `/users/:userId` | Detalhe; inclui todas memberships (vários statuses) para suporte/admin. |

## Serviços e modelo de dados

- **Finance**: modelos **`Subscription`**, **`Invoice`**, **`Organization`**, **`Plan`** — leituras globais. **`Plan`** inclui **`trial_days`**, **`is_public`** (vitrine) e **`custom_organization_id`** (plano sob demanda, FK opcional).
- **Métricas**: **`CreativeAnalysis`**, **`MediaAsset`**, **`UsageCounter`**, **`WebhookEventLog`**, contagens Sequelize/SQL onde agregações são mais simples que `GROUP BY` via API ORM.

## Observação de coexistência `/api/users` vs `/api/admin/users`

- **`GET /api/users`** (feature User): exige **JWT** e lista apenas usuários que compartilham **organização(es)** com o caller (isolamento tenant; ver `Membership`).
- **`GET /api/admin/users`**: painel **Super Admin**, visão global com paginação/roles.

Não confundir os dois na integração frontend.
