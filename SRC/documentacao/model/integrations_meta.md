# Tabela `integrations_meta`

## Papel HOOKO

Armazena o **conjunto OAuth / tokens efêmeros** necessários para chamar APIs da Meta Ads em nome da empresa cliente. Esta tabela só deve ser acessada por serviços com segredos de descriptografia (KMS recomendável).

## Arquivo modelo

`SRC/Models/integrations_meta.js` → model `IntegrationsMeta`, table `integrations_meta`.

## Campos relevantes

| Atributo | Coluna | Tipo JSONB / TEXT |
|----------|--------|-------------------|
| `organizationId` | FK tenant | obrigatório |
| `accessTokenCipher`, `refreshTokenCipher` | TEXT | payloads cifrados *(nunca plain)* |
| `tokenExpiresAt` | TIMESTAMP | opcional caching refresh |
| `oauthMetadata` | JSONB `{}` inicial | dados auxiliares: escopos, user id Meta, erro último refresh |
| `status` | estado integração |

## Índices

Unicidade `integrations_meta_organization_uidx` garante **um registro-canal** inicial por empresa (você poderá shard futuramente usando coluna discriminator se suportarem múltiplas OAuth apps).

Índice `status` permite jobs de watchdog que revivem falhas transientes.

## Associações

`belongsTo Organization`.

## Threat model

Mesmo dentro do backend restrinja queries com `LIMIT 1` + filtro estrito pelo tenant autenticado; nunca use `ORDER BY updated_at DESC` público para enumerar tenants.
