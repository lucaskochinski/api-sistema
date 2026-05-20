# Tabela `creative_analyses`

## Responsabilidades

Registro **persistente consolidado**:

1. **IA** estrutural (`ai_analysis` → atributo `aiAnalysis`).
2. **Snapshot final sintético das métricas** no momento do run IA (`performanceSnapshot`).

> A série temporal de performance bruta granular diária fica **`ad_performance_daily`**, não esta tabela.

## Colunas vitais

| Atributo (JS) | Coluna DB | Papel |
|---------------|-----------|-------|
| `organizationId` | `organization_id` | UUID obrigatório multitenant mesmo com joins. |
| `adId` | `ad_id` | FK lógico `ads.id`. |
| `mediaId` | `media_id` | FK lógico `media_assets.id`. |
| `ctr`, `roas`, `spend` | `ctr`, `roas`, `spend` | `DECIMAL` largos opcionais — KPIs rápidos sem ler JSONB. |
| `performanceSnapshot` | `performance_snapshot` | JSONB — snapshot sintético de performance no momento do run IA. |
| `aiAnalysis` | `ai_analysis` | JSONB — hooks, grades, rationale estruturado. |
| `analyzedAt` | `analyzed_at` | timestamp evento modelo |
| `periodKey` | `period_key` | chave relatório legível opcional (`202605`, `lifetime`, … ) |
| `analysisVersion` | `analysis_version` | tag pipeline / prompt hash reprodutibilidade |

Tipos DECIMAL escolhidos largos porque Meta devolve alta precisão; normalize formatos apenas na boundary API pública.

## Índices

| Nome sugerido modelo | Benefício principal |
|----------------------|---------------------|
| PK `id` UUID | lookups diretos |
| `creative_analyses_organization_id_idx` | relatórios filtrados |
| `creative_analyses_ad_id_idx` | timelines por criativo/ad |
| `creative_analyses_media_id_idx` | clustering histórias asset |
| `creative_analyses_org_analyzed_at_idx` | relatórios “últimos N runs IA” tenant |
| `creative_analyses_org_ad_ts_idx` | drill-down ad + tempo |

*Não há UNIQUE composto obrigando versão única* — permite reruns conscientes quando prompt/pipeline atualiza sem apagar dados de pesquisas anteriores (decisão conscientemente permissiva).

## Associações

`belongsTo` em `Organization`, `Ad`, `MediaAsset`.

## Boas práticas

Ao comparar períodos diferentes, sempre filtre primeira por `organization_id` + opcional índices tempora para evitar vazamentos cross-org se join chain estiver incompleta.
