# Tabela `invoices`

Por que existe além de `subscriptions`?

- **Subscription modela ciclo SaaS atual** (`status`, períodos Stripe, snapshots agregados, plan linkage).
- **Invoice registra obrigações/pagamentos concretos** (open/paid/past due/uncollectible, tentativa de cobrança, valores em centavos, URLs PDF/hospedados, período de fatura, motivo Stripe `billing_reason`).

Stripe emite várias invoices por ciclo (pró-rata upgrades, retrys, addons, créditos) — você **precisa persistir Invoice** não apenas subscription row.

## Principais campos

| Conceito Stripe | Representação técnica coluna HOOKO |
|-----------------|--------------------------------------|
| `id` oficial | `stripe_invoice_id` UNIQUE |
| `number` cliente | `invoice_number` |
| `attempt_count` | `stripe_attempt_count` (+ `next_payment_attempt_at`) |
| `amount_due` | `amount_due_cents` BIGINT |
| `amount_paid` | `amount_paid_cents` |
| Histórias falhos recentes invoice | `last_charge_failure_*` redundantes rápidas |
| snapshot completa | `raw_stripe_snapshot` JSONB |

`stripe_subscription_id_legacy`/`stripe_customer_id_legacy` aceleram relatórios sem joins profundos se snapshot antigo perdido FK.

Associa sempre `organization_id` e opcional `subscription_id` (FK `SET NULL ON DELETE SUBSCRIPTION`) preservando arquivo financeiro mesmo se recriarem assinatura.

## Índices

| Índice | Utilidade drill-down tenant |
|--------|-----------------------------|
| `invoices_stripe_invoice_id_uidx` UNIQUE | dedupe Stripe |
| `invoices_organization_id_idx` |
| `invoices_organization_status_idx` combinado `(organization_id, status)` |
| `invoices_subscription_id_idx` timeline assinatura |

## Integração Stripe

Ao receber `invoice.*`, `invoice.payment_*` webhooks atualize primeiro `webhook_event_logs` depois Upsert Invoice + sincronização `subscriptions` + `payment_transactions`.
