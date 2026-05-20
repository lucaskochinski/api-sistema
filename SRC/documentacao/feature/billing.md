# Feature **Billing — Stripe Checkout + Portal + Webhooks**

Módulo de vendas usando o SDK oficial `stripe`: checkout sessão subscription, Billing Portal cliente e ingestão segura de webhooks com persistência deduplicada em `webhook_event_logs`.

Código em `SRC/Features/Billing/`. Checkout e portal sob **`/api/billing`**; webhook **`POST /api/webhooks/stripe`** é registrado diretamente em [`SRC/App.js`](../../App.js) **antes** de `express.json()` para preservar body bruto (requisito de verificação de assinatura).

## Variáveis de ambiente relevantes

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `STRIPE_SECRET_KEY` | Sim (checkout/portal/processamento) | Chave secreta Stripe. |
| `STRIPE_WEBHOOK_SECRET` | Sim (somente webhook) | Segredo da assinatura do endpoint Stripe CLI / Dashboard. |
| `PUBLIC_APP_URL` / `APP_BASE_URL` | Não — padrão `http://localhost:3000` | Base para montar URLs de sucesso/cancelamento. |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Não | Override explícito; deve incluir `{CHECKOUT_SESSION_ID}` onde aplicável ao padrão Stripe. |
| `STRIPE_CHECKOUT_CANCEL_URL` | Não | URL de aborto Checkout. |
| `STRIPE_BILLING_PORTAL_RETURN_URL` | Não | URL de retorno após uso do Billing Portal (default `${APP_BASE_URL}/billing`). |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Não | Portal configuration id (Stripe Dashboard), se já existir. |
| `STRIPE_WEBHOOK_BODY_LIMIT` | Não | Limite máximo payload raw (default `8mb`). |

## Endpoints

### Vitrine pública (landing, sem JWT)

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/plans/public` | Lista planos com **`is_active: true`** e **`is_public: true`**. Campos por item: **`id`**, **`tierKey`**, **`displayName`**, **`limits`**, **`trialDays`**. IDs Stripe não são expostos. O checkout permanece apenas autenticado em **`POST /api/billing/checkout`** com `planId`. |

Implementação em [`SRC/Features/Plans/`](../../Features/Plans/plans.routes.js).

### Autenticados (`authMiddleware`)

| Método | Caminho | Corpo esperado |
|--------|---------|----------------|
| `POST` | `/api/billing/checkout` | `organizationId` (UUID, opcional se JWT tiver apenas uma membership), `planId` (UUID Plan), opcionalmente `billingEmail`, `billingName`. |
| `POST` | `/api/billing/portal` | `organizationId` (opcional como acima); opcional `returnUrl`. |

**Segurança de planos sob demanda:** se o plano tiver **`custom_organization_id`** definido no banco, o checkout só é permitido quando **`organizationId`** da requisição é igual a esse valor; caso contrário a API retorna **`403`** com `plan_checkout_organization_mismatch`.

**Trial Stripe:** quando **`plans.trial_days` > 0**, `createCheckoutSession` envia **`subscription_data.trial_period_days`** igual a esse número (clamp 0–730).

Respostas típicas: `{ checkoutUrl, sessionId, customerId }` e `{ portalUrl }`.

Pré‑requisitos: plano deve ter `stripe_price_id` preenchido na tabela `plans` (`Plan.stripePriceId`) e estar ativo (`is_active`). Planos públicos vs privados só afetam a vitrine **`GET /api/plans/public`** e a visibilidade comercial — o **`planId`** de um plano exclusivo ainda pode ser usado no checkout pela org correta.

### Webhook (sem JWT)

| Método | Caminho | Body |
|--------|---------|------|
| `POST` | `/api/webhooks/stripe` | **Raw JSON** Stripe Event (header `stripe-signature` obrigatório). |

O handler valida via `stripe.webhooks.constructEvent`, registra/atualiza `webhook_event_logs` com **idempotência** por (`gateway`, `gateway_event_id`) (`gateway_event_id` = Stripe `evt_…`) e processa:

- `checkout.session.completed` (modo `subscription`) → upsert `subscriptions` pela subscrição Stripe;
- `customer.subscription.updated`;
- `customer.subscription.deleted`.

Outros tipos ficam marcados como `processed` com `lastErrorDetail` informativa (`unhandled_type:…`).

Organização é encontrada prioritariamente por `metadata.organization_id` na assinatura; fallback por `stripe_customer_id` na tabela `organizations`. Plano resolvido por `metadata.plan_id` ou pela correspondência **`plans.stripe_price_id`** aos itens Stripe.

## Modelos relacionados

- **`organizations.stripe_customer_id`** — cliente Stripe (criação lazy no checkout quando ausente).
- **`plans.stripe_price_id`** — recurring price id Stripe.
- **`plans.is_public`** — incluído na **vitrine** `GET /api/plans/public` quando também **`plans.is_active`**.
- **`plans.custom_organization_id`** — opcional; se preenchido, checkout restrito à mesma **`organizations.id`** (`403` caso contrário).
- **`plans.trial_days`** — período trial enviado ao Stripe quando > 0.
- **`subscriptions`** — status, períodos Stripe, snapshots em `raw_stripe_snapshot` (JSON sanitizado para armazenamento).

## Seeds

Administrador inicial: comando `npm run seed:super-admin` (sequelize-cli), arquivo [`SRC/seeders/20260211154500-seed-super-admin.js`](../../seeders/20260211154500-seed-super-admin.js). Em execuções normais da API, [`bootstrapDatabase()`](../../bootstrapDatabase.service.js) acionado em [`App.js`](../../App.js) reaplica de forma idempotente o mesmo “super admin”, org **`HOOKO Admin`** e role **`hooko_platform_admin`** (quando migrações/roles existem).

## Operação Stripe CLI (dev)

Registrar listener local direcionado para `localhost:PORT/api/webhooks/stripe`:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use o `whsec_…` imprimido no `STRIPE_WEBHOOK_SECRET` do ambiente de desenvolvimento.
