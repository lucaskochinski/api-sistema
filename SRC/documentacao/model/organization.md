# Tabela `organizations`

## Papel no ecossistema HOOKO

Representa o **tenant** (empresa) — unidade máxima de **isolamento de dados** e de **billing**. Todas as entidades sensíveis (integrações OAuth, criativos, métricas, assinatura Stripe) navegam sempre com um `organization_id` explícito.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/organization.js`
- **Classe:** `Organization`
- **Nome da tabela:** `organizations`
- **Convention:** `underscored: true` (camelCase nos atributos JS / snake_case no Postgres)

## Colunas

| Atributo (JS)       | Coluna (DB)         | Tipo              | Nullable | Observação |
|--------------------|---------------------|-------------------|----------|------------|
| `id`               | `id`                | `UUID` (v4 Sequelize) | Não PK | PK |
| `name`             | `name`              | `STRING(255)` | Não | Nome público/workspace |
| `slug`             | `slug`              | `STRING(120)` | Não | Identificador amigável (URL/workspace) |
| `stripeCustomerId` | `stripe_customer_id`| `STRING(128)` | Sim | FK lógico ao Stripe Customer **sempre** desta empresa (billing tenant-scoped). |
| `createdAt`        | `created_at`      | `TIMESTAMPTZ` | não* | Sequelize automático timestamps |
| `updatedAt`        | `updated_at`      | `TIMESTAMPTZ` | não* | Sequelize automático timestamps |

\*Por padrão Sequelize adiciona `created_at`/`updated_at` quando `timestamps: true` (default).

## Unicidades e índices

| Índice | Campos DB | Observação |
|--------|-----------|-----------|
| `organizations_slug_uidx` | `(slug)` | **UNIQUE** — slug globalmente exclusivo entre tenants |
| `organizations_stripe_customer_id_idx` | `(stripe_customer_id)` | Índice de busca (não obriga unicidade porque pode ser preenchido tardiamente) |

## Associações (FK lógicas / relações Sequelize)

Saídas `hasMany` (todas ligam por `foreignKey: 'organizationId'` salvo onde outro modelo global não carrega FK tenant):

- `Membership`, integrações OAuth (`IntegrationsMeta`, `IntegrationsGoogleDrive`), conta Meta e hierarquia de anúncios (`MetaAdAccount` → `Campaign` → `AdSet` → `Ad`).
- Derivados dados produto (`OrganizationMediaClaim`, `CreativeAnalysis`, `AdPerformanceDaily`).
- Cobrança: `Subscription`, `Invoice`, `WebhookEventLog`, `PaymentTransaction`.
- Metering quotas `UsageCounter`.

## Regras de integridade sugeridas (camada migrações)

- Ao habilitar RLS Postgres, todas as políticas devem sempre filtrar `organization_id = current_setting('app.current_organization_id')::uuid`.

## Observações SaaS / Stripe

Este registro deve ser o **único ponto de ancoragem** do `stripe_customer_id` para evitar cenários onde duas organizações tentem reusar invoices distintos.
