# Tabela `ads`

Representa oficialmente objetos **`Ad`** monitorados/sync para um tenant específico. É onde ancoramos ingest de insights IA + fatos série temporal.

Campos destacados:

| JS | Observação operações |
|----|----------------------|
| `metaAdId` | identificação primária ad API |
| `adSetId` | referência pai |
| `lastSyncedAt` | latência relatórios *staleness detector* dashboards |

Índices presentes modelo:

| Nome |
|------|
| `ads_organization_meta_ad_uidx` UNIQUE `(organization_id, meta_ad_id)` |
| `ads_ad_set_id_idx` INDEX `(ad_set_id)` navega descendência |

Associa coleções IA & fatos métricas.

Integridade: sempre valide FK `organization_id` coerente com `ad_sets.organization_id` via migrações CHECK Postgres ou garantia ingest.
