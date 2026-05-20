# Tabela `role_permissions` (associação Role ⇄ Permission)

## Propósito HOOKO

Tabela de junção **many-to-many** que materializa o **grafo de capacidades** dos papéis. Centralizar aqui permite evoluir permissões sem migração de membership.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/role_permission.js`
- **`RolePermission`**, tabela `role_permissions`

## Estrutura

| Atributo PK | Coluna | Tipo |
|-------------|--------|------|
| `roleId` part1 | `role_id` | UUID **PK** + FK lógico → `roles.id` |
| `permissionId` part2 | `permission_id` | UUID **PK** + FK lógico → `permissions.id` |

> Chave primária composta evita linha surrogate adicional e impede duplicação do par.

## Índices auxiliares

| Índice | Campos | Motivo |
|--------|--------|--------|
| `role_permissions_role_id_idx` | `role_id` | Listar todas permissões por papel |
| `role_permissions_permission_id_idx` | `permission_id` | Descobrir todos papéis concedendo X |

## Associações Sequelize

- `belongsTo Role` (`as: 'role'`)
- `belongsTo Permission` (`as: 'permission'`)

## Timestamps

Desabilitados (`timestamps: false`) por serem puramente derivados de catálogo.

## Observação de integridade

Recomenda migração física com FK `ON DELETE CASCADE` do lado `role` **ou** impedir delete de role com dependências ativas (depende da política produto).
