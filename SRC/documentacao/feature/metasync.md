# Feature **MetaSync** — ingestão por **anúncio (criativo)** + quota mensal

A HOOKO **não** importa mais campanhas inteiras como unidade de cobrança. O utilizador escolhe primeiro uma **campanha** na conta Meta (passo de navegação) e, em seguida, **um anúncio concreto**. Cada **importação/atualização nova** de criativo consome **um crédito mensal** definido no plano (`creative_imports_per_month`). A estrutura Campaign → AdSet → Ad continua a ser persistida (UPSERT dos pais) apenas para **hierarquia e foreign keys** na base de dados.

## Arquivos

| Caminho | Papel |
|---------|--------|
| `SRC/Features/MetaSync/metasync.routes.js` | Rotas HTTP sob `/api/metasync`. |
| `SRC/Features/MetaSync/metasync.controller.js` | Resolve `organizationId` a partir do JWT + HTTP, valida memberships. |
| `SRC/Features/MetaSync/metasync.service.js` | Lista campanhas live, lista ads live, quota, importação de um ad, campos profundos no `creative`, fila `video-transcription-queue`. |
| `SRC/Features/MetaSync/meta_ad_creative_parser.js` | Copy/CTA/dynamic vs `object_story_spec` (vídeo e link) — ver secção abaixo. |
| `SRC/Services/meta_graph.client.js` | Cliente Graph com paginação e backoff em rate-limit. |
| `SRC/Services/plan_limits.service.js` | Chave canónica **`creative_imports_per_month`** (leitura legacy `campaign_imports_per_month` no merge). Migração remove a chave legacy do JSON em `plans.limits`. |

## Fluxo macro (UI + API)

```text
1) GET  /account/:metaActId/live-campaigns
        → ID / nome / status (light). `is_imported` indica se já existe linha `campaigns` para esse `meta_campaign_id` na org (ex.: após algum ad importado).

2) Utilizador escolhe uma campanha

3) GET  /account/:metaActId/campaign/:metaCampaignId/live-ads
        → lista de anúncios com `thumbnail_url` (quando o Graph devolver), `has_video_id`, `is_imported` (cruzamento com `ads` da org).

4) Utilizador escolhe um anúncio

5) POST /account/:metaActId/campaign/:metaCampaignId/ad/:metaAdId/import
        → para **ad novo** nesta org: debita 1 crédito de criativo.
        → GET do Ad no Graph; UPSERT Campaign + AdSet pai + Ad; enfileira vídeo (BullMQ) se `meta_video_id` novo globalmente;
        → pull `ad_performance_daily` **somente** para esse ad na janela de insights.
```

## Variáveis de ambiente úteis

| Variável | Descrição |
|----------|-----------|
| `USAGE_META_CREATIVE_IMPORT_KEY` | Chave em `usage_counters.metric_key`. Default **`meta_creative_import_month`**. Se omitida, **`USAGE_META_CAMPAIGN_IMPORT_KEY`** ainda é aceite para migração. |
| `META_AD_IMPORT_INSIGHT_DAYS` | Janela **padrão** de insights (dias até ontem UTC). Se ausente, usa `META_CAMPAIGN_IMPORT_INSIGHT_DAYS` (~31). |
| `META_SYNC_PAGE_LIMIT`, `META_SYNC_MAX_PAGES`, `META_GRAPH_*` | Cliente Graph (`meta_graph.client.js`). |
| `DEFAULT_CREATIVE_IMPORTS_PER_MONTH` | Teto fallback quando o plano omitir o valor (com fallback legado `DEFAULT_CAMPAIGN_IMPORTS_PER_MONTH`). |
| `PLATFORM_ADMIN_JWT_ROLE_KEY`, `HOOKO_PLATFORM_ADMIN_EMAILS` | Super Admin infinito na **importação** iniciada com JWT correspondente. |

## Quota mensal (`usage_counters` + `plans`)

- **Bucket mensal UTC:** `YYYY-MM` em **`usage_counters.period_label`** (`monthlyPeriodLabelUtc()`).
- **Créditos:** `usage_counters.metric_key` (default **`meta_creative_import_month`**) — **+1** por **anúncio** que ainda **não** existia na org (`ads.meta_ad_id`).
- **Limite (`limit`):** **`plans.limits.creative_imports_per_month`**. O merge ainda **interpreta** valores legados ao carregar (`campaign_imports_per_month`, …). A migração **`20260517121500-canonical-plan-limits-creative-imports.js`** normaliza o JSON persistido: só fica **`creative_imports_per_month`** como chave de quota de import.
- Sem assinatura ativa/trial comercial eficaz ⇒ limites **ZERO** → **`meta_creative_import_quota_exceeded`** na primeira tentativa de debitar.
- **Super Admin** ⇒ limites infinitos na chamada com JWT adequado.

### Erros relacionados à quota

| HTTP | Código/message | Situação |
|------|----------------|----------|
| **429** | `meta_creative_import_quota_exceeded` | Mensal esgotado ou org sem quota; corpo pode incluir `quotaHint`. |

**Reembolso:** se falhar após debitar, **`refundCreativeImportCredit`** faz **−1** no counter (best-effort).

### Introspecção (restam X créditos)

`GET live-campaigns` e `GET live-ads` aceitam `?includeQuota=1`/`true` ⇒ snapshot via `introspectQuotaForFrontend` (`limit`, `used`, `remaining`, `limitless`, `entitlementSource`).

## Org no JWT × múltiplas memberships

- Uma membership ⇒ `organization_id` opcional.
- Várias ⇒ enviar **`organizationId`**: query em **GET** e corpo JSON em **POST import**.

## Meta Ad Account obrigatório

Rotas `:metaActId` exigem **`meta_ad_accounts`** org + conta. Prefixo **`act_`** opcional.

## Endpoints (`/api/metasync`)

### `GET /account/:metaActId/live-campaigns`

Vitrine de campanhas `{ id, name, status, is_imported }` (persistência só na verificação de `is_imported`).

Query: `organizationId`, `includeQuota`.

### `GET /account/:metaActId/campaign/:metaCampaignId/live-ads`

Lista anúncios da campanha com:

- `id`, `name`, `status`
- `thumbnail_url` | `null`
- `has_video_id` (boolean)
- `is_imported` (boolean)

Query: `organizationId`, `includeQuota`.

### `POST /account/:metaActId/campaign/:metaCampaignId/ad/:metaAdId/import`

Importa **apenas** o anúncio `:metaAdId`; valida que o Graph reporta esse ad dentro de `:metaCampaignId`.

Corpo JSON mínimo:

```json
{
  "metaActId": "act_xxxx ou só dígitos",
  "organizationId": "...uuid... (multi-org)",
  "insightsSince": "2026-01-01",
  "insightsUntil": "2026-01-28"
}
```

Resposta inclui campos **`chargedCreativeImportCredit`**, **`reSyncSkippedCredit`**, **`structure`** (`metaCampaignGraphId`, `campaignDbId`, `metaAdId`, `adDbId`, `newMetaVideosQueued`), **`insights`** (diários apenas desse UUID interno).

## Ordem técnica da importação por ad

1. Se não existe `ads` para `(organizationId, metaAdId)` ⇒ debita **`usage_counters`** por `creativeImportMetricKey()`.
2. Valida conta Meta + token OAuth.
3. GET ad (`AD_FIELDS`). Confere **`campaign_id`** contra `:metaCampaignId`.
4. GET campaign head ⇒ confere **`account_id`** vs act ligado (**403** se diverge).
5. UPSERT **`campaigns`**, GET adset pai ⇒ UPSERT **`ad_sets`**.
6. Hidratar o `AdCreative` (expansão **`CREATIVE_GRAPH_FIELDS`**: `object_story_spec`, `asset_feed_spec`, `body`, `title`, …) e aplicar **`meta_ad_creative_parser.parseAdCreativeForStorage`** ⇒ UPSERT **`ads`** com **`primary_text`**, **`headline`**, **`cta_type`**, **`is_dynamic_creative`**, **`raw_creative_data`**, **`meta_video_id`**.
7. Se **`meta_video_id`** ⇒ `media_assets` + **`organization_media_claims`** (`meta_creative_import`) ⇒ **`video-transcription-queue`** só se o vídeo global ainda não existir. O worker (**`videoTranscription.processor.js`**) lê os textos da linha **`ads`** e chama **`generateCreativeInsightsHolistic`** (Gemini) com transcrição Deepgram + copy.
8. Insights diários Graph só deste ad ⇒ **`ad_performance_daily`**.

Pipeline / metadados de performance usam o rótulo **`meta_creative_import`** onde antes era `meta_campaign_import`.

## Colunas extras em **`ads`** (engenharia de dados)

| Coluna | Tipo | Uso |
|--------|------|-----|
| `primary_text` | TEXT | Copy principal (`video_data.message`, `link_data.message`, ou `asset_feed_spec.bodies[0].text`) |
| `headline` | VARCHAR(2048) | Título (`video_data.title`, `link_data.name`, ou `titles[0]`) |
| `cta_type` | VARCHAR(128) | Tipo do botão Meta (`SHOP_NOW`, …) |
| `is_dynamic_creative` | BOOLEAN | `asset_feed_spec` com bodies/titles/videos/… utilizável |
| `raw_creative_data` | JSONB | Payload sanitizado (`id`, `object_story_spec`, `asset_feed_spec`, …) para auditoria |

## Parser de criativo (dynamic vs estático)

Regras alinhadas ao **Guia de Engenharia: Estrutura de Ad Creatives** (Marketing API):

1. **`asset_feed_spec`** com bodies/titles/videos/images/descriptions/`call_to_action_types` ⇒ tratar como **dynamic**: primeira variante onde aplicável (`bodies[0].text`, `titles[0].text`, primeiro `video_id` em `videos[]`, primeiro CTA em `call_to_action_types[]`).
2. Caso contrário ⇒ **estático**: `object_story_spec.video_data` ou **`link_data`** (headline em **`link_data.name`**, não `title`).
3. **Fallback** sempre nos campos raiz do AdCreative (`body`, `title`, `call_to_action_type`) quando os sub-recursos vierem incompletos.
4. **`meta_video_id`**: vídeo único em spec ou primeiro vídeo do feed dinâmico.

Implementação: **`SRC/Features/MetaSync/meta_ad_creative_parser.js`**.

Campos solicitados ao Graph para `creative{…}` (constante **`CREATIVE_GRAPH_FIELDS`**): `object_type`, `body`, `title`, `call_to_action_type`, `video_id`, `thumbnail_url`, `image_url`, `object_story_spec`, `asset_feed_spec`, etc.

## Re-sync gratuito (mesmo anúncio)

Se o `meta_ad_id` **já** está em `ads` para a organização, a chamada **não debita** crédito; ainda assim atualiza hierarquia, criativo/vídeo e insights na janela pedida.

## Migração a partir da versão por campanha

- **`POST /campaign/:id/import`** (campanha inteira) foi **removido**; usar os endpoints acima.
- Planos históricos: após correr **`mergePlanLimits`** + migração **`20260517121500`**, **`plans.limits`** usa **`creative_imports_per_month`**; chave **`campaign_imports_per_month`** deixa de ser guardada.
- **`usage_counters`**: novo default de `metric_key` é **`meta_creative_import_month`**. Ambiente legado pode forçar a chave antiga via env até migração de dados.
