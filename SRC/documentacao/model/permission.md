# Tabela `permissions`

## Papel no ecossistema HOOKO

Unidade atômica de **autorização** (recurso + ação). Permite modelar RBAC declarativo sem hardcode de strings espalhadas pelo código de serviço.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/permission.js`
- **Tabela:** `permissions`

## Colunas

| Atributo | Coluna | Tipo | Observação |
|----------|--------|------|------------|
| `id` | `id` | UUID PK | |
| `key` | `key` | `STRING(128)` | Chave canônica (`creative:read`, `billing:manage`, …). |
| `resource` | `resource` | `STRING(64)` | Namespace lógico do domínio. |
| `action` | `action` | `STRING(64)` | Verbo (`read`, `write`, `delete`, `analyze`). |

## Unicidade e índices

| Nome | Tipo | Campos | Utilidade |
|------|------|--------|-----------|
| `permissions_key_uidx` | UNIQUE | `(key)` | Lookup estável em policies. |
| `permissions_resource_action_idx` | INDEX | `(resource, action)` | Filtros administrativos / introspect tools. |

## Associações

- `belongsToMany Role` via `RolePermission`.
- `hasMany RolePermission`.

## Notas de implementação

A camada HTTP deve **sempre** resolver `membership` ativo + conjunto de `permission.key` agregados dos papéis antes de permitir operações mutáveis.
