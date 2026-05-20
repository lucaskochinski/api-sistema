# Tabela `ad_performance_daily`

## Conceito HOOKO

Armazena **uma linha por (organization, ad, dia calendário)** com payload flexível **`metrics_jsonb`**. Permite ingestão rápida de mudanças de schema da Marketing API encapsuladas sem DDL frequente na plataforma.

## Model Sequelize

Campo Sequelize `snapshotDate` mapeando coluna `snapshot_date DATE` (PostgreSQL tipo `DATE`).

Campo Sequelize `metricsJsonb` usando `field: 'metrics_jsonb'` JSONB.

## Unicidades

Índice `ad_performance_daily_org_ad_day_uidx` garante **`UNIQUE (organization_id, ad_id, snapshot_date)`**.

## Outros índices

| Nome | Alvo típico |
|------|-------------|
| `ad_performance_daily_organization_idx` | agregações cross-ad por tenant |
| `ad_performance_daily_snapshot_date_idx` | backfills paralelos ingest global |

Associações: `Organization`, `Ad`.

## Modelagem JSON

Sugiro convenção estável dentro de JSON (exemplo):

```json
{
  "impressions": 12345,
  "clicks": 420,
  "spend_micro": 987654321,
  "actions": [{"action_type":"purchase","value":33}],
  "_raw_currency": "BRL",
  "_ingested_via": "insights_api_vNN"
}
```

Normalização monetária e micro-vs-decimal ficam encapsuladas em código ETL antes de gravar aqui ou na camada de apresentação.

## Agregações

Para ROAS médio ou CTR rolling use funções Postgres (`jsonb_extract_path_numeric`) OU materialized views especializadas *fora escopo inicial deste model* mas preparadas porque fatos estão já separados temporalmente da camada IA.
