# Tabela `subscriptions`

## Escopo SaaS

Toda cobrança / provisionamento deve referenciar **obrigatoriamente** `organization_id` (billing 100% tenant bound). Esta tabela relaciona empresa → catálogo `plans`.

## Principais campos

| Campo JS | Observação produto |
|----------|---------------------|
| `stripeSubscriptionId` | nullable apenas se cenário manual / trial pré-Stripe persistido antes da conversão cobrança efetiva |
| `status` | espelhar enum Stripe (`trialing`,`active`,`past_due`,`canceled`, … textual ) |
| `currentPeriodStart` | início período atual faturável |
| `currentPeriodEnd` | fim período atual faturável / agendamento downgrade |
| `cancelAtPeriodEnd` | downgrade agendado flag stripe |
| `stripeLatestInvoiceId` | referência rápida ao objeto mais recent no Stripe (`in_latest_invoice`) não substitui tabela invoices |
| `trialEndsAt` | quando trial expira segundo Stripe |
| `pausedAt` / `cancelAt` / `canceledAt` | eventos vitais ciclo Stripe (scheduled vs efectivo) |
| `collectionPausedReason` | motivação textual Stripe collection pause |
| `billingMetadata`, `rawStripeSnapshot` | JSONB snapshots parciais / payloads compactos replay interno |

## Índices

| Nome | Detalhes |
|------|----------|
| `subscriptions_stripe_sub_uidx` UNIQUE | impede dois registros mesmo subscription id oficial *(Postgres permite múltiplas linhas se valor NULL duplicado – normalmente apenas histórias internas)* |
| Índices por org + `(org, status)` aceleram lookups painel cliente |

Associações adicionadas: coleções **`Invoice`** e **`PaymentTransaction`** além das existentes (`Organization`, `Plan`).

## Consistências operacionais

Webhook Stripe deve sempre reconciliar usando **organization_id determinístico**, nunca apenas email user.
