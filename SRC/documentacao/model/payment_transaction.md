# Tabela `payment_transactions`

## Objetivo

Materializar objetos Stripe de liquidação (PaymentIntent / Charge típicos + balance transaction opcional `gateway_balance_transaction_id`) **sem navegar apenas JSON blobs gigantes**.

Benefícios:

- Queries rápidas “últimas falhas organização/subscription/invoices”.
- Correlações explícitas com `webhook_event_log_id`.
- Índices temporais `occurred_at` para relatórios de tentativas (paralelo aos totais já refletidos em `invoices`).

## Índices

| Nome |
|------|
| `payment_transactions_gateway_object_uidx` UNIQUE `(gateway, gateway_object_id)` garante objeto único (ex.: `ch_xxx`, `pi_xxx`) |

Demais FK helper indexes já definidos modelo Sequelize.

Associa obrigatoriamente `organization_id`; `subscription_id`/`invoice_id` opcionais; `failure_code/message` repetem ergonomia rápida (payload completo ainda vai para `webhook_event_logs` & `raw_summary` subset).
