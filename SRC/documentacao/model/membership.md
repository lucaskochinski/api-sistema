# Tabela `memberships`

## Papel no ecossistema HOOKO

Modela a relação **N:N usuário ⇄ empresa** com um **estado explícito** (`invited` / `active` / `suspended`). Esta é também a âncora de elegibilidade para RBAC: papéis não são dados diretos do usuário, mas através de `membership_roles`.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/membership.js`

## Colunas principais

| Atributo        | DB              | Observação |
|----------------|-----------------|------------|
| `id` PK        | `id`            | UUID |
| `organizationId` | `organization_id` | FK lógico → organizations |
| `userId`        | `user_id`       | FK lógico → users |
| `status`       | `status`       | Ciclo vida convite/atividade |

Statuses permitidos pela validação do model: `invited`, `active`, `suspended`.

## Índices

| Índice | Tipificação | Campos |
|--------|-------------|--------|
| `memberships_organization_user_uidx` | **UNIQUE** | `(organization_id, user_id)` — impede duplicar par usuário dentro da mesma org |
| `memberships_user_id_idx` | suporte filtros dashboard | `(user_id)` |

## Associações

Relação `Membership belongsTo Organization` (`as: 'organization'`)  
Relação `Membership belongsTo User` (`as: 'user'`)  
`belongsToMany Role` usando `MembershipRole`.

## Como isolar tenants

Somente memberships com:

1. Mesmo tenant `organization_id`, e
2. `status === 'active'`

devem receber bearer tokens válidos autorizadores.
