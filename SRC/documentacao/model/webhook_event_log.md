# Tabela `webhook_event_logs`

## Missão observabilidade

Guarda **cada webhook de gateway de pagamento** (Stripe inicialmente):

- **Idempotência** garantida pela constraint `UNIQUE (gateway, gateway_event_id)` (Stripe `evt_…`).
- **Payload bruto íntegro** em `payload_jsonb` (+ cabeçalhos sensíveis mínimos em `headers_snapshot` e opcional fingerprint `stripe_signature_received`).
- **Estado operacional**: `processing_status`, `processed_at`, retries (`processing_attempt_count`, `next_retry_after`, `last_error_detail`).
- **Replay auditing** usando `replay_of_event_id` (FK self) + `replay_note` quando reprocessamentos manuais forem criados como novos registros.

Associa opcionalmente `organization_id` quando o despachante consegue inferir tenant imediatamente (útil filtros dashboards), mas **nem sempre será preenchido na ingest inicial** antes de ler o JSON interno (`customer`, `subscription`, etc).

## Associações Sequelize

| Relação |
|---------|
| `belongsTo Organization` (opcional null) |
| `hasMany PaymentTransaction` através de FK `webhook_event_log_id` |
| relacionamento parental self (`replay_parent`/`replay_children`) |

## Índices críticos

| Nome |
|------|
| `webhook_event_logs_gateway_event_uidx` UNIQUE composto `(gateway, gateway_event_id)` |
| `webhook_event_logs_gateway_event_type_idx` |
| `webhook_event_logs_processing_status_idx` |
| `webhook_event_logs_processed_at_idx` |
| `webhook_event_logs_organization_id_idx` |

## Fluxo recomendado

1 Persistir sempre **primeiro** o log (antes de qualquer mutation em `subscriptions`).
2 Marcador `queued` ⇒ job assíncrono processando e atualizando `processed`/`dead_letter`.
3 Replays geram novo registro mantendo vínculo `replay_of_event_id` para lineage.
