# Tabela `media_assets`

## Registry global HOOKO

Objetivo desta entidade é **eliminar trabalho repetido**: download via API Meta/Drive, transcodificação, geração de thumbnails e enfileiramento de jobs IA.

### Unicidades globais (PostgreSQL UNIQUE + comportamento para NULL)

| Coluna (DB) | Regra dedup |
|-------------|--------------|
| `meta_video_id` | **UNIQUE** — no máximo um registro quando o campo está populado (vários NULL são permitidos). |
| `google_drive_file_id` | Mesma regra. |

Ao menos uma chave externa forte ou política aplicacional garantindo identidade física antes de iniciar trabalho cara evita inconsistência.

Campo **`processing_status`** opera como estado de máquina (`ingest`, `downloading`, `transcoding`, `ready`, `failed`, … definidos por serviços).

Campo **`ingest_metadata` JSONB** guarda payloads técnicos longos não normalizados (codec, bitrate reportado, storage keys etapa temporária, etc).

### Índice operacional

`media_assets_processing_status_idx` sobre `processing_status` acelera filas de worker.

### Associações Sequelize

| Saída | Significado |
|-------|-------------|
| `OrganizationMediaClaim` | Quem pode legitimamente consumir esse asset dentro de cada tenant |
| `CreativeAnalysis` | Resultados pontuais de IA sempre amarrados a um `MediaAsset` físico específico |

### Segurança / multi-tenant

Embora a mídia seja **global física**, o acesso lógico exige sempre verificação de existência de `organization_media_claim` para o `(organization_id atual, media.id)`.
