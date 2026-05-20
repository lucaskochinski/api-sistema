# Feature **Meta Ads (Marketing API / OAuth)**

Integração modular em `SRC/Features/Meta/`, persistindo credenciais cifradas em **`integrations_meta`** (um registro por `organization_id` — UPSERT idempotente).

## Arquivos

| Arquivo | Função |
|---------|--------|
| `meta.routes.js` | Rotas HTTP sob `/api/meta`. |
| `meta.controller.js` | Validação de `organizationId` (UUID), interpreta `state` OAuth, respostas sem segredos. |
| `meta.service.js` | Implementa troca de `code`, upgrade long-lived, `debug_token`, escopos exigidos, cifragem e **único ponto** `getValidToken(organizationId)` que devolve access token em plaintext para jobs internos. |

## Variáveis de ambiente

| Variável | Uso |
|----------|-----|
| `META_APP_ID` | App ID Facebook. |
| `META_APP_SECRET` | App Secret. |
| `META_REDIRECT_URI` | Deve casar **exatamente** com o redirect configurado no app e com a URL usada no diálogo OAuth. |
| `META_GRAPH_API_VERSION` | Default `v21.0`. |
| `META_OAUTH_SCOPES` | Opcional; default `ads_read,ads_management,public_profile`. |
| `META_TOKEN_REFRESH_BEFORE_EXPIRY_SEC` | Margem (segundos) para renovar long-lived via `fb_exchange_token` antes do vencimento; default **7 dias**. |
| `TOKEN_ENCRYPTION_KEY` | 64 hex chars (32 bytes) **ou** `TOKEN_ENCRYPTION_KEY_BASE64`. Usada por `SRC/Utils/crypto.js` com AAD = `organizationId`. |

## Fluxo OAuth (resumo)

1. Usuário autenticado (`Authorization: Bearer …`) chama `GET /api/meta/oauth/authorize-url?organizationId=<uuid>` — a org **de** estar nas memberships JWT → recebe `{ authorizeUrl }` com `state` embutindo o tenant (**base64**, ver `SRC/Utils/oauth_state.js`).
2. Usuário autoriza na Meta → redirect para `META_REDIRECT_URI` com `?code=&state=`.
3. Backend trata **`GET`** (redirect real) ou **`POST`** (testes API) em `/api/meta/oauth/callback`:
   - `code` obrigatório;
   - `state` obrigatório no fluxo navegador; em `POST` alternativo pode enviar `{ organizationId, code }` sem `state`.
4. Serviço executa sequência doc: short-lived token → **`fb_exchange_token`** (long-lived) → **`debug_token`** → valida **`ads_read` + `ads_management`** → grava **ciphertext** + `token_expires_at` + `oauth_metadata` (scopes, `graphUserId`, timestamps).

## Renovação / leitura interna

- **`getValidToken(organizationId)`** (alias de `getValidAccessTokenForOrganization`): descriptografa, verifica janela de expiração e/ou `debug_token`, e se necessário renova com `fb_exchange_token` persistindo novo ciphertext.
- **Nenhum token em claro** sai em JSON de controller; logs não imprimem segredos.

## Endpoints

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/meta/oauth/authorize-url?organizationId=` | **JWT obrigatório**. Retorna URL do diálogo; `organizationId` deve estar na membership do token (`403 organization_not_in_membership` se não). |
| `GET` | `/api/meta/oauth/callback` | Callback do provider (`code`, `state`). |
| `POST` | `/api/meta/oauth/callback` | Corpo JSON `{ "organizationId", "code" }` para integração manual. |

## Dependências runtime

- `axios` para chamadas Graph `oauth/access_token` e `debug_token`.

## Referências de código

- Cifragem: [`../../../Utils/crypto.js`](../../../Utils/crypto.js)
- State OAuth: [`../../../Utils/oauth_state.js`](../../../Utils/oauth_state.js)
- Escopo tenant no `authorize-url`: [`../../../Utils/ensure_organization_membership.util.js`](../../../Utils/ensure_organization_membership.util.js)
- Model: [`../../../Models/integrations_meta.js`](../../../Models/integrations_meta.js)
