# Tabela `organization_media_claims`

## Função jurídica / compliance tenant

Declara formalmente qual organização pode **consumir/visualizar/processar um media global**.

## Estrutura

| Campo | Descrição |
|-------|-----------|
| `organization_id`, `media_id` | Componentes obrigatórios |
| `source` *(default `meta_sync`)* | rastrear pipeline (manual import, picker drive, ingest campaign) |
| `claim_metadata` JSONB `{}` inicial | exemplo: primeira campanha, path legal sign-off |

## Indicadores

| Nome índice | Especificação |
|-------------|----------------|
| `organization_media_claims_org_media_uidx` | **UNIQUE** `(organization_id, media_id)` cada org apenas um claim oficial por asset *(estender modelo se granularidade granular por campanha for necessário)* |

Índice adicional campo `media_id` acelera `WHERE media_id IN (...)` após lookups por hash.

Associações: `Organization`, `MediaAsset`.

Sem linha aqui ⇒ serviços IA/baixar arquivo devem impedir mesmo que user conheça UUID interno leaking.
