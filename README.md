# Matrix — Autonomous Agent Orchestration Pipeline

[![Matrix CI](https://github.com/CronusXd/opencode-backup/actions/workflows/ci.yml/badge.svg)](https://github.com/CronusXd/opencode-backup/actions/workflows/ci.yml)
[![State Machine](https://img.shields.io/badge/State%20Machine-8%2F8%20tests-brightgreen)](pipeline/pipeline-spec.yaml)
[![Maturidade](https://img.shields.io/badge/Maturidade-88%25-blue)](docs/matrix-audit-state.yaml)
[![Módulos](https://img.shields.io/badge/M%C3%B3dulos%20Ativos-24%2F24-success)](pipeline/scripts/pipeline-executor.js)

**Matrix** é um pipeline autônomo de orquestração de agentes com 4 fases, construído sobre o ecossistema OpenCode. Ele coordena **40 agentes especialistas** (68 com agentes internos do router) através de um pipeline formal com state machine, validação adversarial, revisão de código, observabilidade completa e Quality Control obrigatório.

**Repositório:** `github.com/CronusXd/opencode-backup` (privado)
**Última atualização:** 28/07/2026
**Maturidade Arquitetural:** 88/100 (auditado em 5 loops)

---

## 📋 Sumário

1. [Arquitetura do Pipeline](#-arquitetura-do-pipeline)
2. [Quality Control (Fable Method)](#-quality-control-fable-method-obrigatório)
3. [24 Módulos Auxiliares](#-24-módulos-auxiliares-ativos)
4. [Agentes Especialistas (40)](#-agentes-especialistas-40)
5. [Observabilidade](#-observabilidade)
6. [Segurança](#-segurança)
7. [Memória e Contexto](#-memória-e-contexto)
8. [RAG e Conhecimento](#-rag-e-conhecimento)
9. [Modelos e Roteamento](#-modelos-e-roteamento)
10. [Estrutura do Projeto](#-estrutura-do-projeto)
11. [Provider 9router](#-provider-9router)
12. [Supabase](#-supabase)
13. [Resolução de Problemas](#-resolução-de-problemas)

---

## 🧠 Arquitetura do Pipeline

O Matrix opera em **4 fases obrigatórias**, com Quality Control integrado e roteamento formal de agentes:

```
USUÁRIO
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  @AgentsOrchestrator                                 ║
║  (NUNCA faz análise — NUNCA escolhe especialista     ║
║   por intuição — SEMPRE usa AgentRouter)             ║
╚═══════════════════════════════════════════════════════╝
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  FASE 1: ANÁLISE (@fable-method-agent — EXCLUSIVO)   ║
║  Step 0 — Classificar demanda                        ║
║  Step 1 — Definir "Done" com critérios verificáveis  ║
║  Step 2 — Reunir evidências (ler código, pesquisar)  ║
║  Step 3 — Decidir + recomendar especialista          ║
║           (via AgentRouter — OBRIGATÓRIO)            ║
║  → Cria todolist com fases + especialistas           ║
╚═══════════════════════════════════════════════════════╝
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  FASE 2: EXECUÇÃO                                     ║
║                                                       ║
║  1. AgentRouter.selectAgent() ← OBRIGATÓRIO           ║
║     (prevalece sobre intuição — se falhar, pipeline   ║
║      NÃO prossegue)                                   ║
║                                                       ║
║  2. Context Builder (CB.1-CB.6):                      ║
║     • Descoberta + pontuação + ranqueamento           ║
║     • Compressão semântica (4 estratégias)            ║
║     • Repo Understanding integrado                    ║
║                                                       ║
║  3. task(@especialista) com contexto otimizado        ║
║     → Implementa + testa + reporta                    ║
╚═══════════════════════════════════════════════════════╝
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  FASE 3: VALIDAÇÃO (@fable-judge) — 🚫 QC            ║
║  • Step 0: Pipeline Compliance Check                  ║
║    ✅ "Especialista correto foi usado?" (AgentRouter) ║
║    ❌ Se errado → VIOLATION                           ║
║  • Steps 1-4: Verificação adversarial                 ║
║    (re-executa testes, detecta fraudes)               ║
║  → VERIFIED / CAVEATS / REFUTED / VIOLATION           ║
╚═══════════════════════════════════════════════════════╝
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  FASE 4: REVISÃO (@code-reviewer) — 🚫 QC            ║
║  • Corretude técnica + Segurança + Estilo + Testes   ║
║  → APPROVED / CHANGES_NEEDED                         ║
╚═══════════════════════════════════════════════════════╝
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║  ENTREGA                                              ║
║  • git add + commit + push                            ║
║  • PR Generator (automático via gh CLI)               ║
║  • "Especialista designado: @[nome]"                 ║
╚═══════════════════════════════════════════════════════╝
```

### State Machine Formal

| Propriedade | Valor |
|-------------|-------|
| Estados | 20 |
| Transições | 27 |
| Fases | 7 (init + fase_1..4 + entrega + final) |
| Testes | 8/8 (validação automática) |
| Validador | `pipeline/scripts/validate-pipeline.js` |

---

## 🔴 Quality Control (Fable Method — OBRIGATÓRIO)

TODO especialista que executa código DEVE passar pelo ciclo de qualidade.
**NENHUM código é commitado sem aprovação.**

### Regras do Quality Control

| # | Regra |
|---|-------|
| **QC1** | NENHUM código commitado sem @fable-judge E @code-reviewer |
| QC2 | Máximo 3 tentativas por fase; se estourar → escalado |
| QC3 | NENHUM especialista pode pular fases 3 ou 4 |
| QC4 | @AgentsOrchestrator é RESPONSÁVEL pelo ciclo completo |
| QC5 | VIOLATION automática se fase de QC for omitida |
| **QC6** | **AgentRouter.selectAgent() é OBRIGATÓRIO** — NUNCA escolher especialista por intuição |

### Fluxo de Retry

```
FASE 3 (Judge) → REFUTADO → FASE 2 (máx 3x) → ESCALADO
FASE 4 (Review) → CHANGES_NEEDED → FASE 2 (máx 3x) → ESCALADO
```

---

## ⚙️ 24 Módulos Auxiliares Ativos

O pipeline executor carrega automaticamente **24 módulos** no startup (verificado em runtime):

| # | Módulo | Arquivo | Função |
|---|--------|---------|--------|
| 1 | ✅ cache | `agent-cache.js` | Cache de estado para agentes |
| 2 | ✅ queue | `task-queue.js` | Fila de tarefas com retry |
| 3 | ✅ router | `model-router.js` | Roteamento cost-aware de modelos |
| 4 | ✅ tokens | `token-tracker.js` | Tracking de tokens e custos |
| 5 | ✅ budget | `cost-budget.js` | Orçamento mensal com alertas |
| 6 | ✅ costMonitor | `cost-monitor.js` | Monitor proativo de custos |
| 7 | ✅ plugins | `plugin-system.js` | 3 plugins ativos |
| 8 | ✅ contextBuilder | `context-executor.js` | Context Builder completo |
| 9 | ✅ tools | `tool-router.js` | 17 ferramentas, 8 categorias |
| 10 | ✅ agentRouter | `agent-router.js` | 67 agentes, 11 categorias |
| 11 | ✅ parallel | `parallel-executor.js` | Execução paralela de tarefas |
| 12 | ✅ sessions | `session-manager.js` | Sessões multi-pipeline |
| 13 | ✅ healer | `self-healing.js` | Self-healing automático |
| 14 | ✅ prGenerator | `pr-generator.js` | PR automático no GitHub |
| 15 | ✅ debug | `pipeline-debug.js` | Pipeline Debugger |
| 16 | ✅ browser | `browser-support.js` | Navegação headless |
| 17 | ✅ docker | `docker-support.js` | Execução em contêineres |
| 18 | ✅ distCache | `cache-distributed.js` | Cache Redis + JSON fallback |
| 19 | ✅ tenant | `tenant-router.js` | Multi-tenant com dados isolados |
| 20 | ✅ schemaDrift | `schema-drift.js` | Detecção de drift entre schemas |
| 21 | ✅ rollback | `rollback-manager.js` | Rollback com snapshots |
| 22 | ✅ auth | `auth-provider.js` | SSO/JWT provider |
| 23 | ✅ siem | `siem-exporter.js` | Exportação SIEM |
| 24 | ✅ release | `release-integration.js` | Release pipeline completo |

### 3 Plugins Ativos

| Plugin | Hooks | Função |
|--------|-------|--------|
| `matrix-logger` | 4 hooks | Logging de transições |
| `metrics-collector` | 1 hook | Coleta de métricas customizadas |
| `pipeline-monitor` | 1 hook | Monitoramento de saúde do pipeline |

---

## 🎯 Agentes Especialistas (40)

Disponíveis em `agents/` com roteamento formal via **Agent Router** (`agent-router.js`).

### Categorias

| Categoria | Agentes | Exemplos |
|-----------|---------|---------|
| **🎨 Design & UX** | 7 | @ArchitectUX, @UI-Designer, @UX-Researcher |
| **💻 Engineering** | 15 | @backend-architect, @frontend-developer, @senior-developer |
| **🗄️ Dados & BD** | 4 | @database-optimizer, @data-engineer |
| **🌐 CMS & E-commerce** | 4 | @cms-developer, @drupal-shopping-cart-engineer |
| **🔧 DevOps & Infra** | 4 | @devops-automator, @sre-site-reliability-engineer |
| **📱 Marketing & Growth** | 8 | @marketing-growth-hacker, @marketing-content-creator |
| **📋 Produto & Projetos** | 7 | @project-manager-senior, @product-sprint-prioritizer |
| **🧪 Testes & Qualidade** | 8 | @EvidenceQA, @testing-reality-checker, @security-agent |
| **📝 Suporte & Operações** | 8 | @technical-writer, @prompt-engineer, @git-workflow-master |
| **📱 Integrações** | 4 | @feishu-integration-developer, @wechat-mini-program-developer |

### Roteamento via Agent Router (OBRIGATÓRIO)

```bash
# Consultar especialista para uma tarefa
node pipeline-executor.js select-agent backend 4
# → { agent: "@backend-architect", category: "engineering", reason: "..." }

# Informações de um agente
node pipeline-executor.js agent-info security-agent

# Fallback global quando não há match específico
# → @senior-developer (conforme regra do AGENTS.md)
```

---

## 📊 Observabilidade

### Dashboard em Tempo Real

- HTML5 + CSS3 + JavaScript puro (zero dependências)
- Gráficos Canvas (barras + pizza/donut)
- **WebSocket** para dados em tempo real (com fallback para polling a cada 5s)
- Exponential backoff na reconexão (1s → 30s, até 50 tentativas)
- Indicador visual: 🔵 Live (WS) / 🟢 Live (Polling) / ⚪ Static
- 3 breakpoints responsivos (desktop >1024px, tablet, mobile)
- API REST: `/api/status`, `/api/metrics`, `/api/events`, `/api/health`
- Badge de conexão com localStorage persistente

### Métricas Coletadas

| Métrica | Fonte | Descrição |
|---------|-------|-----------|
| Tokens | `token-tracker.js` | Input/output por modelo, custo em USD |
| Custos | `cost-budget.js` | Budget mensal (US$50), gasto real, projeção semanal |
| Transições | `state.json` | Histórico completo de mudanças de estado |
| Eventos | `events.log` | JSON Lines com rotação a 500KB |
| Performance | `pipeline-debug.js` | Timing de cada fase, buffer circular 1000 entradas |
| Benchmarks | `ci-benchmark.js` | 3 suites executadas no CI, baseline salvo |
| Cobertura | `.nycrc.json` | nyc com snapshot de baseline, detecção de regressão |

### Cost Monitor Proativo

```bash
node pipeline-executor.js cost-report     # Relatório diário detalhado
node pipeline-executor.js cost-forecast   # Projeção semanal de gastos
node pipeline-executor.js cost-alert-history  # Histórico de alertas
```

Alertas automáticos: WARNING >80%, CRITICAL >95% do budget.

### Quality Gates no CI (BLOCKING)

O CI do GitHub Actions (`ci.yml`) executa em ordem:

1. ✅ Check syntax
2. ✅ Validate state machine (8/8)
3. ✅ Run test suite (12/12)
4. ✅ **TypeScript type check** (tsc --noEmit) 🔥 **BLOCKING**
5. ⚠️ Check test coverage (NON-BLOCKING)
6. ✅ Check for secrets
7. ✅ Lint YAML files
8. ✅ **ESLint** 🔥 **BLOCKING**
9. ✅ **Prettier** 🔥 **BLOCKING**

---

## 🔒 Segurança

| Componente | Descrição |
|-----------|-----------|
| **Sandbox** | Whitelist de comandos + blacklist de perigosos |
| **RBAC** | 3 roles (admin, developer, readonly) — sem auto-promoção |
| **Secrets Scanner** | 7 padrões regex (tokens, senhas, chaves AWS, JWT, etc.) |
| **Auth Provider** | JWT/OAuth2/OpenID com fallback para RBAC interno |
| **Security Agent** | `agents/security-agent.md` dedicado |
| **File Restrictions** | Diretórios permitidos configurados |

---

## 🧠 Memória e Contexto

### Memory Service (6 namespaces)

| Namespace | TTL | Conteúdo |
|-----------|-----|----------|
| `decisoes` | Permanente | Decisões arquiteturais |
| `contexto` | Sessão | Contexto da demanda atual |
| `preferencias` | Permanente | Preferências do usuário |
| `projeto` | Permanente | Dados do projeto atual |
| `historico` | 30 dias | Histórico de execuções |
| `checkpoints` | 7 dias | Snapshots para recovery |

**Backend:** JSON (padrão) → SQLite (experimental) → PostgreSQL (configurado, depende de DATABASE_URL)

### Context Builder

```
CB.1 → Descoberta (glob + grep)
CB.2 → Pontuação (5 regras de relevância)
CB.3 → Eliminação (score < 3, padrões excluídos)
CB.4 → Ordenação (score decrescente)
CB.5 → Montagem (template + compressão semântica)
CB.6 → Entrega (contexto otimizado ao especialista)
```

- **Compressão semântica**: 4 estratégias (truncate, keyword_lines, section_extract, smart)
- **Repo Understanding**: análise estrutural do projeto (817+ arquivos)
- **Cache**: local (JSON) + distribuído (Redis opcional)

---

## 📚 RAG e Conhecimento

| Modo | Status | Descrição |
|------|--------|-----------|
| TF-IDF | ✅ Ativo | Indexação local sem dependências |
| Embeddings | ⚠️ Fallback | Requer Matrix_RAG_API_KEY |
| Híbrido | ⚠️ Fallback | TF-IDF + embeddings combinados |
| Vector Store | ✅ Integrado | SQLite com cosine similarity |

### Como Ativar Embeddings

Para ativar o modo **hybrid** (TF-IDF + Embeddings) ou **embeddings** (apenas embeddings semânticos):

1. Obtenha uma API key compatível com OpenAI API (ex: 9router, OpenAI, Anthropic)
2. Defina a variável de ambiente:
   ```bash
   set Matrix_RAG_API_KEY=sua-chave-aqui
   ```
3. Edite `pipeline/rag-config.yaml` e altere `mode` para `"hybrid"` ou `"embeddings"`
4. Execute o setup:
   ```bash
   node pipeline/scripts/setup-rag.js
   ```
5. Verifique o status:
   ```bash
   node pipeline/scripts/setup-rag-embeddings.js --check-only
   ```

> **NOTA:** Sem a API key, o RAG opera em modo `tfidf` (funcional, sem dependências externas).
> O fallback é automático — o sistema nunca quebra se a chave não estiver configurada.

---

## 🔧 Modelos e Roteamento

### Model Router (Cost-Aware)

| Tier | Modelo | Custo/1K tok | Uso |
|------|--------|-------------|-----|
| Thinking | Claude Sonnet 4.5 Thinking | $0.005 | Arquitetura, segurança |
| Premium | Claude Sonnet 4-6 | $0.003 | Código, análise complexa |
| Medium | Gemini 2.5 Flash | $0.00015 | Refatoração, docs |
| Cheap | DeepSeek v4 Flash | **Grátis** | Consultas, formatação |

**Quality-Aware Routing** também disponível: `selectModelQualityAware(taskType, complexity, qualityWeight)`

---

## 🏗️ Estrutura do Projeto

```
D:\OpenCode\
├── AGENTS.md                   ← Regras globais de roteamento (256 linhas)
├── opencode.jsonc              ← Config principal (provider 9router + MCP)
├── package.json                ← Scripts npm (test, validate, coverage, typecheck)
├── tsconfig.json               ← TypeScript config (checkJs gradual)
├── .nycrc.json                 ← Istanbul/nyc coverage config
│
├── .github/workflows/
│   ├── ci.yml                  ← CI com quality gates blocking
│   └── release.yml             ← Release pipeline
│
├── agents/                     ← 39 especialistas (.md)
│   ├── agents-orchestrator.md  ← Orquestrador (default)
│   ├── fable-method-agent.md   ← Análise Fable
│   ├── fable-judge.md          ← Validação adversarial
│   ├── code-reviewer.md        ← Revisão técnica
│   ├── security-agent.md       ← Segurança dedicada
│   └── ...
│
├── pipeline/
│   ├── pipeline.yaml           ← State machine (20 estados, 27 transições)
│   ├── state.json              ← Estado atual da execução
│   ├── checklist.json          ← Verificação por fase
│   ├── memory.yaml             ← Config do Memory Service
│   ├── memory.json             ← Dados da memória (6 namespaces)
│   ├── context-builder.yaml    ← Config do Context Builder
│   ├── observability.yaml      ← Config de telemetria
│   ├── sandbox.yaml            ← Regras de execução segura
│   ├── rbac.json               ← Permissões RBAC
│   ├── cost-budget.json        ← Budget de custos ($50/mês)
│   ├── auth-config.yaml        ← SSO/JWT provider
│   ├── branch-strategy.md      ← Estratégia de branches
│   ├── FABLE-QC-MANDATORY.md   ← Documento QC obrigatório
│   ├── dashboard.html          ← Dashboard de observabilidade
│   ├── events.log              ← JSON Lines — append-only
│   ├── metrics.json            ← Contadores cumulativos
│   ├── plugin-events.log       ← Eventos dos plugins
│   ├── cost-alerts.log         ← Alertas de custo
│   │
│   ├── scripts/                ← 65+ scripts (todos em JS)
│   │   ├── pipeline-executor.js  ← Motor central (4205 linhas)
│   │   ├── pipeline-runtime.js   ← Monitor passivo
│   │   ├── validate-pipeline.js  ← Validador da state machine
│   │   ├── agent-router.js       ← Agent Router (67 agentes)
│   │   ├── tool-router.js        ← Tool Router (17 tools)
│   │   ├── model-router.js       ← Model Router cost-aware
│   │   ├── token-tracker.js      ← Tracking de tokens
│   │   ├── memory-adapter.js     ← Adaptador de memória (JSON)
│   │   ├── pg-memory-adapter.js  ← Adaptador PostgreSQL
│   │   ├── context-executor.js   ← Context Builder (CB.1-CB.6)
│   │   ├── context-compressor.js ← Compressão semântica
│   │   ├── repo-understanding.js ← Análise do repositório
│   │   ├── self-healing.js       ← Recuperação automática
│   │   ├── schema-drift.js       ← Detecção de drift
│   │   ├── rollback-manager.js   ← Rollback com snapshots
│   │   ├── cost-monitor.js       ← Monitor proativo de custos
│   │   ├── auth-provider.js      ← SSO/JWT provider
│   │   ├── pr-generator.js       ← PR automático no GitHub
│   │   ├── pipeline-debug.js     ← Pipeline Debugger
│   │   ├── browser-support.js    ← Navegação headless
│   │   ├── docker-support.js     ← Execução em contêineres
│   │   ├── siem-exporter.js      ← Exportação SIEM
│   │   ├── audit-trail.js        ← Audit trail
│   │   ├── slack-notifier.js     ← Notificação Slack
│   │   ├── lib/                  ← Utilitários compartilhados
│   │   │   ├── yaml-utils.js     ← Parser YAML (zero deps)
│   │   │   ├── tokenizer.js      ← Tokenização para TF-IDF
│   │   │   ├── file-utils.js     ← Utilitários de arquivo
│   │   │   └── fases.js          ← Mapeamento estado → fase
│   │   └── types/                ← TypeScript .d.ts
│   │       ├── pipeline.d.ts
│   │       └── agent-router.d.ts
│   │
│   ├── tests/                   ← 20+ arquivos de teste
│   │   ├── run-all.js           ← Runner principal
│   │   ├── test-pipeline-executor.js
│   │   ├── test-memory-adapter.js
│   │   ├── test-agent-router.js
│   │   ├── test-cache-distributed.js
│   │   ├── test-cost-monitor.js
│   │   ├── test-schema-drift.js
│   │   ├── test-new-modules-integration.js
│   │   └── ...
│   │
│   ├── plugins/                 ← 3 plugins ativos
│   │   ├── matrix-logger-plugin.js
│   │   ├── metrics-collector-plugin.js
│   │   └── pipeline-monitor-plugin.js
│   │
│   ├── tenants/                 ← Multi-tenant
│   │   ├── _template/           ← Template para novos tenants
│   │   └── config.json
│   │
│   ├── audit/                   ← SIEM compliance
│   │   ├── trail.json
│   │   └── compliance-report-*.md
│   │
│   └── migrations/              ← Migration SQL
│       └── 001-create-memories.sql
│
└── projeto/                     ← Projetos reais
    ├── NC_BOT_OFICIAL/
    ├── Otimizador/
    └── cabal/
```

---

## 🌐 Provider 9router

O OpenCode usa o provider **9router** para rotear entre múltiplos modelos de IA.

```jsonc
"provider": {
  "9router": {
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "http://127.0.0.1:20128/v1",
      "apiKey": "${9ROUTER_API_KEY}"
    }
  }
}
```

### Modelos Disponíveis (8)

| ID | Modelo | Provider | Custo |
|----|--------|----------|-------|
| `kr/claude-sonnet-4.5-thinking-agentic` | Claude Sonnet 4.5 Thinking | krypton | $0.005/1K |
| `ag/claude-sonnet-4-6` | Claude Sonnet 4-6 | agentic | $0.003/1K |
| `ag/gemini-3-flash` | Gemini 3 Flash | agentic | $0.0001/1K |
| `oc/deepseek-v4-flash-free` | DeepSeek v4 Flash (grátis) | opencode | Grátis |
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | krypton | $0.003/1K |
| `gemini/gemini-2.5-pro` | Gemini 2.5 Pro | gemini | $0.002/1K |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | gemini | $0.00015/1K |
| `ag/gpt-oss-120b-medium` | GPT OSS 120B | agentic | $0.0001/1K |

---

## 🔌 Supabase — Conexão

Projeto: **NC BOT** (`parcczwisfkelwxbqgzg`)

```jsonc
"mcp": {
  "supabase": {
    "type": "remote",
    "url": "https://mcp.supabase.com/mcp?project_ref=parcczwisfkelwxbqgzg",
    "enabled": true
  }
}
```

---

## ❗ Resolução de Problemas

### Pipeline não funciona

```cmd
:: Verificar state machine
node pipeline/scripts/validate-pipeline.js

:: System health check
node pipeline/scripts/pipeline-executor.js check

:: Verificar módulos
node pipeline/scripts/pipeline-executor.js modules
```

### Agentes não aparecem no autocomplete

```cmd
:: Verificar OPENCODE_CONFIG_DIR
echo %OPENCODE_CONFIG_DIR%
:: Deve apontar para %APPDATA%\opencode
```

### Provider 9router não conecta

```cmd
:: Verificar se está rodando
curl http://127.0.0.1:20128/v1/models
```

---

## 📈 Histórico de Maturidade

| Data | Loop | Maturidade | Problemas | Módulos |
|------|------|-----------|-----------|---------|
| 26/07/2026 | Baseline | 68% | 20 | 5 |
| 27/07/2026 | Loop 1 | 78% | 7 | 12 |
| 27/07/2026 | Loop 2 | 85% | 0 | 16 |
| 27/07/2026 | Loop 3 | 90% | 0 | 20 |
| 27/07/2026 | Loop 4+5 | **93%** 🏆 | **0** | **20** |
| 28/07/2026 | Loop 5 | 88% | 5 | 24 |

---

*Matrix — Autonomous Agent Orchestration Pipeline • 88% Maturidade • 24 Módulos • 40 Agentes*
