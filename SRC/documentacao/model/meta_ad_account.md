# Tabela `meta_ad_accounts`

## Papel HOOKO

Espelho local das contas de anúncio da Meta (`act_xxxxxxxx`) que uma organização conectada via OAuth decidiu importar/sync. Esta entidade permite:

1. Garantir idempotência de ingest antes de navegar objetos mais profundos.
2. Aplicar `UNIQUE (organization_id, meta_act_id)` para bloquear duplicatas vindas de webhooks paralelos ou re-auths.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/meta_ad_account.js`
- **Nome da classe:** `MetaAdAccount`
- **Nome da tabela:** `meta_ad_accounts`

## Colunas

| Atributo JS | Coluna DB | Tipo | Nullable |
|---------------|-----------|------|----------|
| `id` | `id` | UUID PK | Não |
| `organizationId` | `organization_id` | UUID | Não (FK tenant) |
| `metaActId` | `meta_act_id` | STRING(64) | Não (`act_123` sem prefixo opcional pela camada ingest) |
| `name` | `name` | STRING(255) | Sim |

## Índices

| Índice | Tipificação | Campos físicos |
|--------|-------------|----------------|
| `meta_ad_accounts_organization_act_uidx` | **UNIQUE** | `(organization_id, meta_act_id)` |

## Associações

| Lado Sequelize | cardinalidade destino |
|----------------|-----------------------|
| `belongsTo Organization` (`as organization`) | muitos-para-um |
| `hasMany Campaign` (`as campaigns`) | um-para-muitos |

## Boas práticas operacionais

- Renomeações de conta no Business Manager apenas atualizam `name`; o `meta_act_id` permanece invariante.
- Não delete linhas salvo migrações arquivísticas — preferir marcação soft `archived_at` caso futura extensão (não inicialmente modelada aqui mas pipeline pode precisar).
