# Feature **Google Drive (OAuth 2.0)**

Feature modular em `SRC/Features/GoogleDrive/`, com tokens persistidos em **`integrations_google_drive`** (UPSERT por `organization_id`). Inclui colunas adicionadas por migração `access_token_cipher` e `token_expires_at` para armazenar access token curto de forma cifrada e permitir checagem local de expiração.

## Arquivos

| Arquivo | Função |
|---------|--------|
| `googledrive.routes.js` | Rotas `/api/google-drive/...` |
| `googledrive.controller.js` | Validação UUID, callback GET/POST sem expor segredos. |
| `googledrive.service.js` | `google-auth-library` (`OAuth2Client`), troca de `code`, refresh com `refreshAccessToken`, UPSERT cifrado, **`getValidToken(organizationId)`** devolvendo apenas access token em plaintext para consumo interno. |

## Variáveis de ambiente

| Variável | Uso |
|----------|-----|
| `GOOGLE_CLIENT_ID` | OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | Secret. |
| `GOOGLE_REDIRECT_URI` | Redirect registrado no Google Cloud Console. |
| `GOOGLE_OAUTH_SCOPES` | Opcional; lista separada por espaço ou vírgula. Default inclui `drive.readonly`, `drive.file`, `openid`, `email`, `profile`. |
| `GOOGLE_TOKEN_REFRESH_BUFFER_MS` | Margem antes do vencimento para refresh (default 5 min). |
| `TOKEN_ENCRYPTION_KEY` / `TOKEN_ENCRYPTION_KEY_BASE64` | Mesma chave AES-256-GCM usada pela Meta; AAD = `organizationId`. |

## Fluxo OAuth

1. Com **JWT**, `GET /api/google-drive/oauth/authorize-url?organizationId=<uuid>` (org na membership do token) → `{ authorizeUrl }` com `access_type=offline` e `prompt=consent` (**necessário** para `refresh_token` na primeira ligação / após revogação).
2. Google redireciona com `code` + `state`.
3. `GET` ou `POST /api/google-drive/oauth/callback` processa e persiste:
   - `refresh_token` e `access_token` **cifrados**;
   - `token_expires_at` derivado de `expiry_date` (ms) retornado pela biblioteca.
4. Se `refresh_token` não vier (reauth sem `prompt=consent`), serviço responde erro **`google_refresh_token_missing_retry_with_consent`** (HTTP 409 sugerido).

## Renovação

- `getValidToken(organizationId)` (alias `getValidGoogleAccessToken`) carrega credenciais, compara `expiry_date` com buffer local; se necessário chama `refreshAccessToken()` e **regrava** ciphertexts + metadata (`lastPersistedAt` / `lastRefreshedAt`).
- **Não** logar tokens; controllers nunca retornam esses campos.

## Endpoints

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/google-drive/oauth/authorize-url?organizationId=` | **JWT obrigatório**; mesmo critério de tenant que Meta. |
| `GET` | `/api/google-drive/oauth/callback` | Redirect do Google. |
| `POST` | `/api/google-drive/oauth/callback` | `{ "organizationId", "code" }` para testes. |

## Migração de schema

- `SRC/migrations/20260511160000-add-google-drive-access-token-columns.js` adiciona `access_token_cipher` e `token_expires_at`.

## Referências

- Model: [`../../../Models/integrations_google_drive.js`](../../../Models/integrations_google_drive.js)
- Crypto / state: [`../../../Utils/crypto.js`](../../../Utils/crypto.js), [`../../../Utils/oauth_state.js`](../../../Utils/oauth_state.js)
- Escopo JWT no `authorize-url`: [`../../../Utils/ensure_organization_membership.util.js`](../../../Utils/ensure_organization_membership.util.js)
