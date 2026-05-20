# HOOKO — Documentação dos Models (`SRC/Models/index.js`)

## Função deste arquivo

`index.js` carrega todas as factories Sequelize declaradas sob `SRC/Models`, instancia cada `Model` compartilhando **um único** `sequelize` vindo de `SRC/Config/database.js` e executa `associate(models)` ciclicamente após todas estarem disponíveis (evita `ReferenceError` de dependências cruzadas).

## Ordem determinística atual

Lista explícita (não alphabetical automático):

1. `Organization`, `User`, `Membership` — núcleo multi-tenant base.
2. `Role`, `Permission`, junctions RBAC (`RolePermission`, `MembershipRole`).
3. Credenciais: `IntegrationsMeta`, `IntegrationsGoogleDrive`.
4. Hierarquia campanhas: `MetaAdAccount` → `Campaign` → `AdSet` → `Ad`.
5. Mídia: `MediaAsset` + entitlement `OrganizationMediaClaim`.
6. Insights: série temporal `AdPerformanceDaily` + consolidado IA `CreativeAnalysis`.
7. SaaS Billing: `Plan`, `Subscription`, `Invoice`, `WebhookEventLog`, `PaymentTransaction`, `UsageCounter`.

## Como importar nos serviços

```javascript
const {
  sequelize,
  Organization,
  Ad,
  CreativeAnalysis,
} = require('../Models'); // exemplo relativo dentro de SRC/Features/foo
```

> Recomende-se sempre desestruturar models necessários apenas—facilit tree-shake mental quando o projeto dividir bundles.

## Padrões transversais

| Padrão | Detalhes |
|--------|----------|
| UUID PK | `UUIDV4` default Sequelize |
| Nomes colunas físicas | Snake case via option `underscored: true` |
| Índices | Declarativos dentro de `Model.init` → ajuda futura sincronização com migrations |
| JSONB estratégicos | payloads variáveis (métricas Insight, resultado IA flexível). |

### Multi-tenant

Toda linha tenant-scoped contém FK `organization_id` **exceto**:

- Registry global (`media_assets`).
- Catalogos SaaS (`plans`).
- Principais usuários quando isolados até membership.

Mas **consumo dados** sempre valida entitlement adicional onde necessário (claims de mídia).

## Ciclo inicialização Sequelize

Ao subir servidor:

1 Instanciar `sequelize.authenticate()`
2 Produção sempre executa migrações versionadas antes do deploy (`sequelize-cli db:migrate`; `npm start` encadeia isso por padrão).

## Associações críticas rápidas (mapa textual)

```
Organization 1 ── * Subscription
Organization 1 ── * Ad
Organization 1 ── * UsageCounter

Ad 1 ── * CreativeAnalysis
Ad 1 ── * AdPerformanceDaily

MediaAsset 1 ── * OrganizationMediaClaim
MediaAsset 1 ── * CreativeAnalysis
```

## Versionamento docs

Este índice descreve o snapshot arquitetural na geração original; incremente sempre que novo model surgir antes de merges mainline.
