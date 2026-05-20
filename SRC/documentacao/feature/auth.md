# Feature **Auth — login, registro e JWT**

Documentação das credenciais no modelo **`User`** (`password_hash`/bcrypt): ver [`SRC/Models/user.js`](../../Models/user.js) e [modelagem `user`](../../documentacao/model/user.md). Tenant via **`Membership`** + RBAC (**`membership_roles`**, papel `admin`). O painel SaaS usa papel distinto **`hooko_platform_admin`** (configurável por **`PLATFORM_ADMIN_JWT_ROLE_KEY`**) — ver também [admin.md](./admin.md).

## Onde está o código

| Caminho | Papel |
|---------|--------|
| `SRC/Features/Auth/auth.routes.js` | Rotas HTTP `/api/auth/...`. |
| `SRC/Features/Auth/auth.controller.js` | Camada Express fina → service. |
| `SRC/Features/Auth/auth.service.js` | `login`, `register`, `getMeProfile`, **`jwtSecret`** (validação). |
| `SRC/Middlewares/auth.middleware.js` | `Bearer` JWT obrigatório → `req.user`. |
| `SRC/Middlewares/role.middleware.js` | **`requireJwtRole(roleKey)`** — checa papel no payload do JWT. |

Montagem da API em [`SRC/Routes/index.js`](../Routes/index.js): `router.use('/auth', authRoutes)`.

## Login unificado

**Usuários de tenant** e **administradores de plataforma** usam o mesmo **`POST /api/auth/login`**. A diferença está em **`roles`**: o token inclui a união das chaves de **`roles.key`** de todas as **memberships `active`** e, opcionalmente, o papel **`hooko_platform_admin`**.

### Como obter `hooko_platform_admin` no JWT (sem novo endpoint)

Duas formas suportadas em conjunto:

1. **Bypass por e-mail (bootstrap / dev / small team)**  
   Lista em **`HOOKO_PLATFORM_ADMIN_EMAILS`** (e-mails separados por vírgula, espaço ou ponto-vírgula). No **login**, se o usuário corresponder, **`hooko_platform_admin`** é adicionado aos `roles` do token mesmo sem linha extra em **`membership_roles`**.

2. **RBAC canônico (produção)**  
   Garantir existência da role seeded **`hooko_platform_admin`** (`migrations/20260512103000-seed-auth-roles.js`), criar/obter **`membership_roles`** ligando esse `role_id` a uma membership válida (`active`) do usuário.

> O papel **`admin`** em JWT significa apenas **administrador da própria organização** criada/registrada — **não** abre o painel SaaS. O pré-requisito do painel é **`hooko_platform_admin`** (ou valor customizado em **`PLATFORM_ADMIN_JWT_ROLE_KEY`**).

### Registro inicial de tenant (`register`)

**`POST /api/auth/register`** (JSON):

```json
{
  "email": "owner@example.com",
  "password": "minimum8chars",
  "organizationName": "Minha agência LTDA"
}
```

Em transação Sequelize:

1. Cria **`organizations`** (slug derivado do nome).
2. Cria **`users`** com **`password_hash`** (bcrypt, custo `BCRYPT_SALT_ROUNDS`, default ~12).
3. Cria **`memberships`** `active`.
4. Atribui role **`admin`** via **`membership_roles`** se a migração de seed já tiver corrido.

Resposta **201** inclui **`accessToken`**, mesmo shape resumido de usuário que o login.

### Endpoints públicos/autenticados

| Método | Caminho | Auth | Corpo |
|--------|---------|------|-------|
| `POST` | `/api/auth/register` | Não | `email`, `password`, `organizationName` |
| `POST` | `/api/auth/login` | Não | `email`, `password` |
| `GET` | `/api/auth/me` | `Authorization: Bearer` | — |

Erros típicos: **400** validação/credencial vazia, **401** login inválido ou token ausente/expirado, **409** e-mail já usado no registro.

## JWT

| Claim | Significado |
|-------|--------------|
| `sub` | `users.id` |
| `email` | Normalizado lowercase |
| `roles` | `string[]` (chaves RBAC + bypass plataforma) |
| `memberships` | `[{ organizationId, membershipId, status }]` (memberships **`active`** no momento do login) |

Variáveis de ambiente obrigatórias/relevantes:

| Variável | Uso |
|----------|-----|
| `JWT_SECRET` | Segredo HS256 (**mín. 16 caracteres** em runtime). |
| `JWT_EXPIRES_IN` | Ex.: `7d` (padrão se omitido). |
| `HOOKO_PLATFORM_ADMIN_EMAILS` | E-mails que ganham **`hooko_platform_admin`** no token. |
| `PLATFORM_ADMIN_JWT_ROLE_KEY` | Override da chave exigida em `/api/admin/*` e do bypass por e-mail (default `hooko_platform_admin`). |
| `BCRYPT_SALT_ROUNDS` | Custo bcrypt (inteiro). |

Dependências NPM: **`bcryptjs`**, **`jsonwebtoken`** (ver `package.json`).
