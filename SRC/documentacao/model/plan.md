# Tabela `plans`

## Propósito

Catálogo versionado dos **pacotes SaaS**. Amarra lado Stripe (`stripe_price_id`) com **limitações declarativas** (`limits JSONB`). Exemplo chaves internas dentro de limits:

```json
{
  "creative_analyses_per_month": 500,
  "seats_max": 5,
  "feature_flags": { "benchmark": true }
}
```

## Índices

| Nome | Tipo |
|------|------|
| `plans_tier_key_uidx` UNIQUE sobre `tier_key` | garante nomenclatura comercial determinística |

Índice `is_active` acelera listagem apenas planos disponíveis na landing interna/admin.

Associações: Coleção `Subscription`.

Campos obrigatórios mínimos: `tier_key`, `display_name`.

## Ciclo vida

Ao descontinuar tier, apenas marque `is_active = false` — **subscriptions ativas continuam válidas até renovação/expiração Stripe** tratada pela aplicação de billing.
