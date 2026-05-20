# Feature **Dashboard**

Agregação multi-tenant de KPIs, insights criativos (IA + performance) e catálogo de campanhas já importadas para filtros na UI.

O código está em `SRC/Features/Dashboard/`; rotas são montadas em [`SRC/Routes/index.js`](../../../Routes/index.js) como **`/dashboard`**, sobre o prefixo global **`/api`** ([`SRC/App.js`](../../../App.js)).

## Segurança e isolamento

- Todas as rotas aplicam **`authMiddleware`** (`Authorization: Bearer <JWT>`).
- **`organizationId`** vem da query ou do body (**`organizationId`**) quando o JWT tiver várias memberships; caso contrário, quando houver apenas uma membership, ela é usada automaticamente (mesmo padrão de **MetaSync**).
- Todas as consultas são filtradas por **`organization_id`** correspondente ao tenant resolvido; campanhas e ads de outras organizações não entram nos resultados.

## Prefixo base

```text
/api/dashboard
```

## Cotas SaaS × dashboard

Os números de **analytics** (`spend`, `ROAS`, `creative_analyses`, etc.) refletem o que já foi persistido pelos pipelines de ingestão (**MetaSync**). A unidade comercial de importação ligada ao plano não é mais “campanha inteira”: é **crédito por criativo/anúncio** importado (ver **`creative_imports_per_month`** e feature **MetaSync**). O Dashboard **não** debita quotas; apenas lê dados.

## Endpoints

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/dashboard/overview` | KPIs da organização: **total gasto** (soma de `spend` em `ad_performance_daily`), **ROAS médio global** ponderado pelo spend quando aplicável (`SUM(roas*spend)/SUM(spend)`), **total de análises criativas** (linhas em `creative_analyses`). |
| `GET` | `/api/dashboard/insights` | Lista anúncios com a **última** entrada em `creative_analyses` por `ad_id`; inclui `aiAnalysis`, `performanceSnapshot` salvos na análise e um **rollup** agregado a partir de `ad_performance_daily` (spend, impressões, cliques, ROAS ponderado, CTR efetivo). Inclui `thumbnailUrl` (Drive quando houver `google_drive_file_id`) e URL de visualização Drive. Paginação: **`page`**, **`limit`** (máximo 100). Filtro: **`campaignId`** (UUID interno da tabela `campaigns`). Ordenação: **`sort`** = `roas` (padrão) ou `ctr`. |
| `GET` | `/api/dashboard/imported-campaigns` | Lista campanhas persistidas (`campaigns`) da organização, com conta Meta associada (`meta_ad_accounts`), para popular filtros na UI. **Nota:** após o pivot por ad, uma campanha pode aparecer aqui assim que **pelo menos um** anúncio dessa campanha tiver sido importado. |

## Parâmetros de query (`insights`)

| Parâmetro | Obrigatório | Exemplo |
|-----------|--------------|---------|
| `organizationId` | Sim, se várias memberships | UUID |
| `page` | Não — padrão `1` | `1` |
| `limit` | Não — padrão `20`, máximo `100` | `24` |
| `campaignId` | Não | UUID da linha importada (`campaigns.id`) |
| `sort` | Não — `roas` ou `ctr` | `ctr` |

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `dashboard.routes.js` | Router Express + `authMiddleware`. |
| `dashboard.controller.js` | Resolve tenant e memberships; query params HTTP. |
| `dashboard.service.js` | Queries SQL Sequelize / agregações; não exposto ao cliente. |

## Relações de dados (`insights`)

- `creative_analyses` (última por anúncio) → `ads` → `ad_sets` → `campaigns` → `media_assets`.
- Métricas de performance vêm do **rollup** sobre `ad_performance_daily` por `ad_id`; o payload `performanceSnapshot` no JSON da análise é o mesmo persistido pelo pipeline Bull (Deepgram + Gemini).
