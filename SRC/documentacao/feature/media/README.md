# Feature **Media** — análise assíncrona (transcrição + insights)

Documentação das mudanças que introduzem **processamento em background** para vídeo: fila BullMQ + Redis, worker dedicado, integração Deepgram (transcrição) e Gemini (insights via serviço de análise criativa). O código da API HTTP vive em `SRC/Features/Media/`; workers e filas em `SRC/Workers/`; integrações pontuais em `SRC/Services/`.

## O que foi adicionado

1. **`POST /api/media/:mediaId/analyze`** — só **enfileira** o trabalho e responde **202 Accepted**. A requisição não espera Deepgram nem IA.
2. **Fila principal** **`video-transcription-queue`** — jobs BullMQ com nome interno `deepgram_transcribe_and_insights`.
3. **Fila DLQ** **`video-transcription-dlq`** — após falha final (retries esgotados) ou erro **não recuperável**, o worker envia payload para observabilidade / reprocessamento manual.
4. **Estados em `media_assets.processing_status`** — transição durante o pipeline; ver tabela abaixo.
5. **Persistência em `creative_analyses`** — linha criada ao concluir com sucesso (transcrição + JSON de insights).

## Árvore de arquivos (código relevante)

| Caminho | Papel |
|---------|--------|
| `SRC/Features/Media/media.routes.js` | `POST /:mediaId/analyze`. |
| `SRC/Features/Media/media.controller.js` | HTTP fino → service. |
| `SRC/Features/Media/media.service.js` | Valida org/media/ad/claim, enfileira job, marca `queued_video`. |
| `SRC/Routes/index.js` | Registra **`router.use('/media', mediaRoutes)`** sob `/api`. |
| `SRC/Workers/index.js` | Bootstrap do **Worker** BullMQ + handler `failed` (DLQ + `failed`). |
| `SRC/Workers/redisConnection.js` | Cliente **ioredis** compatível BullMQ. |
| `SRC/Workers/queues/constants.js` | Nomes das filas. |
| `SRC/Workers/queues/videoTranscription.queue.js` | **Queue**, defaults de retry/backoff, `enqueueVideoAnalyzeJob`, `pushDlqJob`. |
| `SRC/Workers/processors/videoTranscription.processor.js` | Pipeline: Drive → Deepgram → `creative_analysis` → DB. |
| `SRC/Services/deepgram.service.js` | POST `/v1/listen` com buffer binário. |
| `SRC/Services/creative_analysis.service.js` | Gemini: gancho / nota / sugestões a partir da transcrição. |
| `SRC/Features/GoogleDrive/googledrive.service.js` | `fetchDriveFileWithBinary` (metadata + download) para o worker. |

## Prefixo de URL

```text
/api/media
```

## Endpoint

| Método | Caminho completo | Resposta típica | Descrição |
|--------|------------------|-----------------|-----------|
| `POST` | `/api/media/:mediaId/analyze` | **202** + `{ status, message, jobId, mediaId }` | **JWT obrigatório** (`Authorization: Bearer`). Body JSON: **`organizationId`** e **`adId`**. O job inclui snapshot leve `{ email, roles }` do token para metering coerente no worker. Exige **`OrganizationMediaClaim`**, **`Ad`** da mesma organização e **`googleDriveFileId`** no `MediaAsset`. |

Erros esperados (via handler global): **400** (UUID inválido), **403** (sem claim), **404** (mídia ou ad), **422** (sem arquivo no Drive associado).

## Fluxo do worker (resumo)

1. Busca **`MediaAsset`**, atualiza **`transcribing`**, baixa binário pelo **Google Drive** (`organizationId` + `googleDriveFileId`).
2. Chama **Deepgram** (`transcribeMediaBuffer`). Falhas de rede/5xx **são retratadas** pelo BullMQ (attempts + backoff).
3. Atualiza **`awaiting_ai`**, lê copy no **`ads`** e chama **`generateCreativeInsightsHolistic`** (Gemini: vídeo + texto).
4. Cria **`CreativeAnalysis`** com `aiAnalysis` (gancho, nota, sugestões, metadados) e marca **`processed`**.

Em falha de IA durante retries, pode haver **`failed_ai`** até o job falhar de vez ou ser retentado, conforme o processor.

Em **falha final**, o listener em `Workers/index.js` tenta atualizar **`processing_status`** para **`failed`**, enriquecer `ingest_metadata` e **empurrar job na DLQ**.

## Estados sugeridos em `processing_status`

| Valor | Quando |
|-------|--------|
| `queued_video` | Logo após **202**, job aceito na fila. |
| `transcribing` | Worker começou; arquivo em processamento Deepgram. |
| `awaiting_ai` | Transcrição ok; esperando Gemini. |
| `failed_ai` | Erro temporário ou falha antes de nova tentativa na etapa IA (consulte logs). |
| `processed` | Pipeline concluído com **`creative_analyses`** gravado. |
| `failed` | Esgotaram-se retries ou erro **UnrecoverableError** (ex.: mídia inexistente, sem Drive id). |

> A coluna permanece **`STRING(32)`** nas migrações; valores longos devem ser encurtados ou o schema evoluído se necessário.

## Variáveis de ambiente

### Redis / BullMQ

| Variável | Descrição |
|----------|-----------|
| `REDIS_URL` | Se definida, usa URL única (alternativa a host/port). |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | Conexão clássica. |
| `REDIS_TLS` | `1` ou `true` para TLS (`{}` no cliente). |
| `VIDEO_JOB_ATTEMPTS` | Tentativas do job (padrão **5**). |
| `VIDEO_JOB_BACKOFF_MS` | Base do backoff exponencial (ms). |
| `VIDEO_JOB_KEEP_COMPLETED` | Jobs completos mantidos (`removeOnComplete`). |
| `WORKER_VIDEO_CONCURRENCY` | Concorrência do worker (padrão **3**). |

### Deepgram

| Variável | Descrição |
|----------|-----------|
| `DEEPGRAM_API_KEY` | Obrigatória para transcrever. |
| `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_API_BASE_URL`, `DEEPGRAM_SMART_FORMAT`, `DEEPGRAM_REQUEST_TIMEOUT_MS` | Opcionais (vide `deepgram.service.js`). |

### Gemini (análise criativa)

| Variável | Descrição |
|----------|-----------|
| `GEMINI_API_KEY` | Preferida; aceita também `GOOGLE_GENERATIVE_AI_API_KEY` ou `GOOGLE_AI_API_KEY`. |
| `GEMINI_MODEL`, `GEMINI_MAX_TRANSCRIPT_CHARS` | Opcionais. |

Credenciais e tokens OAuth do Google Drive já documentados na feature Drive permanecem necessários para o download no worker.

## Como executar localmente

- Subir **Redis**.
- **`npm start`** — API (migrations + `SRC/App.js`).
- **`npm run worker:video`** — processo **`node SRC/Workers/index.js`** consumindo **`video-transcription-queue`**.

Sem o worker os jobs ficam apenas enfileirados; a API segue respondendo **202**.

## DLQ e reprocessamento

Jobs na **`video-transcription-dlq`** trazem `reason`, flags, `attemptsMade`, `payload` original e timestamps. Para reprocessar, use ferramentas BullMQ/Redis ou um script/admin que reinsira payload na fila principal após corrigir causa (credencial, arquivo, etc.) — fluxo administrativo não exposto nesta doc.

---

Relacionado ao modelo **`MediaAsset`**: [`../../model/media_asset.md`](../../model/media_asset.md) e **`creative_analyses`**: [`../../model/creative_analysis.md`](../../model/creative_analysis.md).
