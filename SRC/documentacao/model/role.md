# Tabela `roles`

## Visão HOOKO

Um **papel de negócio** reutilizável globalmente (`admin`, `analyst`, `viewer`, …). As permissões são ligadas através de `role_permissions` e ativadas **por empresa** apenas quando combinadas ao `Membership` via `membership_roles`.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/role.js`
- **Tabela:** `roles`

## Colunas

| Atributo | Coluna | Tipo | Nullable | Descrição |
|----------|--------|------|----------|-----------|
| `id` | `id` | UUID PK | Não | |
| `key` | `key` | `STRING(64)` | Não | Identificador estável (machine-friendly). |
| `name` | `name` | `STRING(128)` | Não | Nome exibido na UI. |

## Unicidade

| Índice | Campos | Regra |
|--------|--------|--------|
| `roles_key_uidx` | `(key)` | **UNIQUE** global — evita papéis duplicados logicamente. |

## Associações

- `hasMany RolePermission` — detalhe quais `Permission` o papel agrega.
- `belongsToMany Permission` via `RolePermission`.
- `belongsToMany Membership` via `MembershipRole` — ativa o papel **no contexto de uma membership** (portanto, de uma org).

## Boas práticas

Mantenha `key` imutável após produção; alterações devem versionar ou criar novo papel para não quebrar auditoria.
