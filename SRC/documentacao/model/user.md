# Tabela `users`

## Papel no ecossistema HOOKO

Representa uma **identidade autenticável** independente da empresa (princípio clásso multi-tenant: um mesmo humano pode ser convidado a múltiplas orgs através de `memberships`). Não existe `organization_id` direto aqui por desenho.

## Modelo Sequelize

- **Arquivo:** `SRC/Models/user.js`
- **Classe:** `User`
- **Nome da tabela:** `users`
- **`underscored: true`**

## Colunas

| Atributo (JS)         | Coluna                | Tipo               | Nullable | Observação |
|----------------------|------------------------|-------------------|----------|------------|
| `id`                 | `id`                   | UUID | Não (PK) | |
| `email`              | `email`                | `STRING(320)` | Não | Login/canonical |
| `passwordHash`       | `password_hash`        | `STRING(255)` | Sim | Omitir quando IdP federado apenas |
| `authProviderSubject`| `auth_provider_subject`| `STRING(255)` | Sim | `"sub"` de provedores OAuth/OIDC externos |
| `createdAt`, `updatedAt` | timestamps padrão | | | Auditoria técnica |

## Unicidade

| Índice | Campos DB | Observação |
|--------|-----------|-----------|
| `users_email_uidx` | `(email)` | **UNIQUE** — garante um cadastro canonical por inbox |

Associação Sequelize:

```text
User hasMany Membership (foreignKey organizationId lado Membership + user_id)
Membership belongsTo User
```

Validação opcional recomendável (service layer): garantir formato email internacionalizado antes de gravar.

## Segurança

Nunca exponha `password_hash` ou campos externos em payloads públicos ou logs estruturados.
