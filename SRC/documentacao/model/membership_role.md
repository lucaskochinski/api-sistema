# Tabela `membership_roles` (associação Membership ⇄ Role)

## Propósito HOOKO

Implementa o **RBAC contextual**: um usuário pode ter papéis diferentes em empresas diferentes, ou múltiplos papéis **na mesma** empresa (_union_ de permissões). A chave é sempre o `membership_id`, nunca o usuário isolado.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/membership_role.js`
- **Tabela:** `membership_roles`

## Estrutura (PK composta)

| Atributo PK | Coluna FK | Ref |
|-------------|-----------|-----|
| `membershipId` | `membership_id` → `memberships.id` | Instância usuário+tenant |
| `roleId`       | `role_id` → `roles.id` | Papel concedido |

Índices não-unique paralelos nos FKs ajudam varreduras por membership ou papel.

## Associações

- `belongsTo Membership` (`as: 'membership'`)
- `belongsTo Role` (`as: 'role'`)

Integração Sequelize `Membership.belongsToMany Role { through: MembershipRole }` simplifica attaches.

## Estado & convites

Recomenda-se validar também `Membership.status === 'active'` antes de conceder papel efetivamente operacional (`service layer`), mesmo que permissão já exista.

## Auditoria opcional futura

Caso precise rastrear `granted_at`/`revoked_at`, migre esta tabela surrogate (`id UUID`) — decidiu-se inicialmente formato lean.
