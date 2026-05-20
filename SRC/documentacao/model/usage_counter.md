# Tabela `usage_counters`

## Razão HOOKO

Fornece métricas de **consumo rápido** sem varrer fatos grandes (ex.: contar creatives analisados no mês) — ideal quando enforcement de quotas precisa responder em tempo real antes de iniciar novo job IA.

Esquema chave-valor dimensional:

| Atributo | Significado exemplo |
|----------|---------------------|
| `metricKey` | `creative_ai_runs`, `videos_transcoded_gb` … |
| `periodLabel` | `202605` formato fixo texto evita TZ ambíguos no label |
| `value` INTEGER | incremento atomizado via `UPSERT … ON CONFLICT` na camada repo |

Índice composto **`UNIQUE (organization_id, metric_key, period_label)`**.

Associações: `belongsTo Organization`.

## Fluxo recomendado

1 Antes iniciar ingest IA — `BEGIN`/`SELECT … FOR UPDATE` counter row OR advisory lock keyed org-month.
2 Ao sucesso finalize commit.
3 Ao falhar parcial garanta compensação decrement.

## Futuro opcional

Trocar granularity field `TIMESTAMPTZ period_start` se necessário relatórios alinhados ciclo Stripe vs calendário comercial divergindo.
