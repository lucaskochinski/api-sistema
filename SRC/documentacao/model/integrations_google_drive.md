# Tabela `integrations_google_drive`

Similar `integrations_meta` porém especializada **upload/import** de arquivos de vídeo (Drive File Picker workflows). Persiste apenas `refresh_token_cipher` porque access tokens são curtos podendo ser tratados apenas em-memory.

Campo **`oauthMetadata` JSONB** pode guardar IDs de folders raiz configurados pela UI.

## Índices

`integrations_google_drive_organization_uidx UNIQUE (organization_id)` — garante inicialmente integração singleton por tenant *(ajustável se multi-contas corporativas forem roadmap)*.

## Associações

`belongsTo Organization`.

### Boas práticas

Ao receber arquivo, derive `google_drive_file_id` e faça UPSERT direcionando para `MediaAsset` antes de iniciar ingest remoto paralelo para evitar duplicidade física pipeline.
