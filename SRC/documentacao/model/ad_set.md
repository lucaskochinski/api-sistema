# Tabela `ad_sets`

## Propósito

Camada obrigatória entre `campaigns` e `ads` refletindo o objeto **Ad Set** e seus parâmetros de segmentação/targeting sintetizados apenas indiretamente neste modelo (detalhes adicionais podem ir JSON em extensões futuras se necessários).

Campos obrigatórios similares `campaign`:

| JS | Observação rápida |
|----|------------------|
| `organizationId`, `campaignId`, `metaAdsetId`, `name?` |

## Índices

| Nome índice | Regra UNIQUE |
|-------------|----------------|
| `ad_sets_organization_adset_uidx` | `(organization_id, meta_adset_id)` garante unicidade real do recurso dentro do tenant (mesmo se campanhas forem reorganizadas) |

| Complementares | FINALIDADE |
|----------------|-----------|
| `ad_sets_campaign_id_idx` INDEX | lookups descendent campanhas → conjuntos grandes |

Associações: `Organization`, `Campaign`, coleção `Ad`.

## Guidance performance

Ao expandir relatórios, prefira filtros sempre `WHERE organization_id = …` inicial independentemente de estar embutidos via join `campaign`; reduz trabalho planner em volumes altos futuros.
