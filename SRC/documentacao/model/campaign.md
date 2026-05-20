# Tabela `campaigns`

## Responsabilidades

Representa objetos **`Campaign`** dentro da hierarquia Marketing API. Agrupa vários conjuntos/anúncios e reduz espaço dimensional em relatórios de criativos (filtramos frequentemente primeiro por conta & campanha).

## Campos

| JS | DB | Nullable | Descrição |
|----|----|----------|-----------|
| `organizationId` | `organization_id` | Não | Replicação denormalizada intencional multitenant rápido. |
| `metaAdAccountId` | `meta_ad_account_id` | Não | Encadeamento estrito à conta de origem. |
| `metaCampaignId` | `meta_campaign_id` | Não | ID oficial string API. |
| `name` | `name` | Sim | Friendly label cache (pode ficar stale se sync incompleto). |

## Índices

| Nome | Regra campos físicos |
|------|-----------------------|
| `campaigns_account_campaign_uidx` | **UNIQUE** `(meta_ad_account_id, meta_campaign_id)` — impede recriar objeto duplicado após ingest concorrentes |
| `campaigns_organization_id_idx` INDEX | `(organization_id)` relatórios transversais filtradas por tenant primeiro |

Associações: `Organization`, `MetaAdAccount`, coleção `AdSet`.

### Consistency note

Ao mover campanhas entre contas Meta (cenário rare), atualize sempre `meta_ad_account_id` transacionalmente com checagens de segurança (evita orphaned `ad_sets`).
