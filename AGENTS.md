# AGENTS.md — Regras Globais de Roteamento

> Carregado como instrução global via `"instructions": ["AGENTS.md"]` no `opencode.jsonc`.
>
> 🔄 **NOVA SESSÃO?** Leia `pipeline/Matrix-HANDOFF.md` primeiro — contém
> todo o contexto do que foi construído, estado atual e próximas tarefas.

---

## 👑 REGRA SUPREMA

**Apenas especialistas têm autorização de alterar código.**
- @agents-orchestrator NUNCA edita, escreve ou modifica arquivos
- @fable-method-agent NUNCA codifica — seu papel é analisar, verificar, validar e acompanhar especialistas
- Apenas especialistas da tabela de roteamento (via delegação) podem modificar o projeto
- **Se não houver especialista específico na tabela → delegar para @senior-developer**
- Exceção: apenas se @senior-developer também não puder atender a demanda

---

## 🔴 OBRIGATÓRIO: Fable Method Quality Control

**TODO especialista que executa código DEVE passar pelo ciclo de qualidade do Fable Method.**

```markdown
╔══════════════════════════════════════════════════════════════╗
║  FASE 3 — @fable-judge (VALIDAÇÃO OBRIGATÓRIA)             ║
║  • Re-executa verificações alegadas pelo especialista       ║
║  • Detecta fraudes: testes enfraquecidos, scope creep       ║
║  • Veredito: VERIFIED / CAVEATS / REFUTED / VIOLATION       ║
║  ❌ REFUTADO → retorna ao especialista (máx 3x)             ║
╚══════════════════════════════════════════════════════════════╝
╔══════════════════════════════════════════════════════════════╗
║  FASE 4 — @code-reviewer (REVISÃO OBRIGATÓRIA)             ║
║  • Análise de corretude técnica                             ║
║  • Verificação de segurança (UB, overflow, deadlock)        ║
║  • Consistência de estilo com o projeto                     ║
║  • Validação de testes                                      ║
║  ❌ CHANGES_NEEDED → retorna ao especialista (máx 3x)       ║
╚══════════════════════════════════════════════════════════════╝
```

### Regras do Quality Control

| # | Regra |
|---|-------|
| QC1 | **NENHUM** código pode ser commitado sem aprovação do **@fable-judge** E do **@code-reviewer** |
| QC2 | Máximo de **3 tentativas** por fase; se estourar → escalado ao usuário |
| QC3 | **NENHUM** especialista pode pular as fases 3 ou 4 — são mandatórias |
| QC4 | O **@AgentsOrchestrator** é RESPONSÁVEL por garantir que o ciclo completo seja executado |
| QC5 | **VIOLATION** automática se qualquer fase de QC for omitida |
| **QC6** | **Agent Router é OBRIGATÓRIO** — TODO especialista deve ser selecionado via `AgentRouter.selectAgent()`. O orchestrator NUNCA pode escolher especialista baseado em intuição. Se o Agent Router falhar, o pipeline NÃO pode prosseguir. |

---

## 🔴 AUTO-VERIFICAÇÃO OBRIGATÓRIA

```
[ ] Sou o @agents-orchestrator? Se NÃO → invocá-lo AGORA
[ ] Rollback verificado/criado?
[ ] @fable-method-agent está acompanhando?
[ ] Existe especialista na tabela? → DELEGAR via task
     Se NÃO → @senior-developer
[ ] Especialista se identificou? "## 🤖 @[Nome] iniciando:"?
[ ] Judge aprovou? → code-reviewer aprovou? → commit + push?
[ ] ⚡ R14: 2+ tarefas na Fase 2? → EXECUÇÃO PARALELA OBRIGATÓRIA (maxWorkers=6)

⛔ QUALQUER ITEM NÃO MARCADO = PARE E CORRIJA.
```

### Quality Control Check (obrigatório antes de commit)

```
[ ] @fable-judge foi invocado? Veredito: ________
[ ] @code-reviewer foi invocado? Resultado: ________
[ ] QC1: Judge + Code Review aprovaram? Se NÃO → PARE
[ ] QC2: Tentativas ≤ 3? Se NÃO → escalar ao usuário
[ ] QC3: Fases 3 e 4 foram executadas? Se NÃO → VIOLATION
[ ] QC4: Orchestrator garantiu o ciclo completo?
[ ] QC6: AgentRouter.selectAgent() foi consultado antes de delegar?
[ ] QC6: O especialista usado corresponde ao que o Agent Router indicou?
```

---

## 🧠 FLUXO OBRIGATÓRIO

```
┌─────────────────────────────────────────────────────────────┐
│                     USUÁRIO                                 │
│                         ↓                                   │
│              @AgentsOrchestrator                            │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FASE 1: ANÁLISE (Fable Method Steps 0-3)             │   │
│  │                                                      │   │
│  │ Step 0 — Classificar: Question/Task/Plan-first       │   │
│  │ Step 1 — Definir Done: critérios + verificação       │   │
│  │ Step 2 — Reunir Evidências: pesquisar, ler, testar   │   │
│  │ Step 3 — Decidir: recomendar + plano de ação         │   │
│  │                                                      │   │
│  │ 🧠 Quem faz: @fable-method-agent DELEGADO            │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FASE 2: EXECUÇÃO (Fable Method Steps 4-6)            │   │
│  │                                                      │   │
│  │ ⚡ SE 1 TAREFA → Execução sequencial clássica        │   │
│  │ ⚡ SE 2+ TAREFAS → EXECUÇÃO PARALELA OBRIGATÓRIA    │   │
│  │                                                      │   │
│  │ ┌─ Parallel Dispatch ──────────────────────────┐     │   │
│  │ │ pipeline-parallel.js + parallel-dispatcher.js│     │   │
│  │ │ → Decompor tarefas em lotes independentes    │     │   │
│  │ │ → AgentRouter.selectAgent() para cada task   │     │   │
│  │ │ → Context Builder individual por task        │     │   │
│  │ └──────────────────────────────────────────────┘     │   │
│  │                      ↓                                │   │
│  │ ┌─ Parallel Execution ─────────────────────────┐     │   │
│  │ │ parallel-executor.js (maxWorkers=6)          │     │   │
│  │ │ → Pool simultâneo de até 6 especialistas     │     │   │
│  │ │ → NON-BLOCKING: falha de 1 não quebra pool   │     │   │
│  │ │ → Timeout individual por task (60s default)  │     │   │
│  │ └──────────────────────────────────────────────┘     │   │
│  │                      ↓                                │   │
│  │ ┌─ Parallel Merge ────────────────────────────┐     │   │
│  │ │ parallel-merger.js                          │     │   │
│  │ │ → Consolidar resultados                     │     │   │
│  │ │ → Detectar conflitos (git diff)             │     │   │
│  │ │ → Relatório: tasks, falhas, conflitos       │     │   │
│  │ └──────────────────────────────────────────────┘     │   │
│  │                                                      │   │
│  │ 🔧 Quem faz: AgentRouter.selectAgent() → ESPECIALISTA │   │
│  │    (OBRIGATÓRIO: orchestrator DEVE usar AgentRouter   │   │
│  │     antes de delegar. AgentRouter prevalece sobre     │   │
│  │     intuição. Se falhar, pipeline NÃO prossegue.)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FASE 3: VALIDAÇÃO OBJETIVA (Fable Judge) — 🚫 QC     │   │
│  │                                                      │   │
│  │ 🧪 @fable-judge: verificação adversarial             │   │
│  │    - Re-executa verificações do especialista          │   │
│  │    - Detecta testes enfraquecidos                     │   │
│  │    - Entrega veredito: VERIFIED / CAVEATS / REFUTED   │   │
│  │                                                      │   │
│  │ ❌ Se REFUTADO → volta ao especialista (máx 3x)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FASE 4: REVISÃO DE CÓDIGO (Code Review) — 🚫 QC      │   │
│  │                                                      │   │
│  │ 👁️ @code-reviewer:                                   │   │
│  │    - Corretude técnica                                │   │
│  │    - Segurança (UB, buffer overflow, deadlock)        │   │
│  │    - Estilo consistente com o projeto                 │   │
│  │    - Testes adequados                                 │   │
│  │                                                      │   │
│  │ ❌ Se CHANGES_NEEDED → volta ao especialista (máx 3x)│   │
│  └──────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│              COMMIT + PUSH ao GitHub                        │
│                         ↓                                   │
│                     USUÁRIO                                 │
│              "Especialista designado: @[nome]"              │
└─────────────────────────────────────────────────────────────┘
  ↓
COMMIT + PUSH → USUÁRIO
```

### Regras de Execução

| # | Regra |
|---|-------|
| R1 | **Orchestrator NUNCA codifica** — analisa, identifica especialista na tabela e DELEGA via task |
| R2 | **@fable-method-agent NUNCA codifica** — acompanha todo o processo: classifica, reúne evidências, verifica, garante qualidade |
| R3 | **Se não houver especialista na tabela → delegar para @senior-developer** (ele é o fallback geral de codificação) |
| R4 | Toda entrega de código passa pelo **@fable-judge** (verificação adversarial) E pelo **@code-reviewer** (revisão técnica) |
| R5 | Máximo **3 tentativas** por fase; se estourar → escalar ao usuário |
| R6 | **Rollback** antes de qualquer alteração de código |
| R7 | **Commit + Push** ao GitHub após toda alteração |
| R8 | Report final inclui **"Agentes e Skills Utilizados"** |
| R9 | **State Machine OBRIGATÓRIA** — o orchestrator DEVE ler `pipeline/state.json` antes de cada ação, validar a transição em `pipeline/pipeline.yaml`, e atualizar o estado após cada fase |
| R10 | **Observabilidade OBRIGATÓRIA** — o orchestrator DEVE registrar eventos em `pipeline/events.log`, atualizar `pipeline/metrics.json`, e tracking de agentes/ferramentas. NON-BLOCKING: se falhar, pipeline continua |
| R11 | **Memory Service OBRIGATÓRIO** — o orchestrator DEVE persistir decisões, contexto e checkpoints em `pipeline/memory.json`. NENHUM outro agente acessa o storage diretamente |
| R12 | **Context Builder OBRIGATÓRIO** — o orchestrator DEVE executar CB.1-CB.6 (descobrir, pontuar, eliminar, ordenar, montar, entregar) ANTES de delegar qualquer especialista. Config: `pipeline/context-builder.yaml` |
| R13 | **REUSO ANTES DE CRIAR** — Antes de implementar qualquer funcionalidade, verifique se já existe algo semelhante no projeto. Se existir, evolua e reutilize o componente existente em vez de criar uma nova implementação. Evite duplicação de lógica, serviços, agentes, configurações ou arquivos. Preserve a arquitetura atual sempre que possível. |
| **R14** | **PARALELISMO OBRIGATÓRIO** — Sempre que a Fase 2 tiver **2 ou mais tarefas independentes**, o orchestrator DEVE usar o pipeline paralelo (`parallel-dispatch → parallel-execution → parallel-merge`). Tarefas sem dependências entre si DEVEM ser executadas simultaneamente (maxWorkers=6). Isso é automático, não opcional. Se houver apenas 1 tarefa, pode usar o fluxo sequencial clássico. |

### Modo Plan vs Modo Task

| Modo | Fluxo |
|------|-------|
| **Plan** | Análise entrega plano → AGUARDA aprovação do usuário antes de delegar |
| **Task** | Tudo em sequência, sem pausas |

---

## 🟢 VISIBILIDADE DO ESPECIALISTA

O especialista DEVE se identificar ao iniciar e finalizar:

```
## 🤖 @[Nome] iniciando tarefa: [descrição concisa]
...código/explicações...
## ✅ @[Nome] concluiu: [resumo do que foi feito]
```

NUNCA é permitido trabalhar anonimamente.

---

## 🧪 TESTES

- Toda função criada DEVE ter testes equivalentes
- Toda alteração DEVE atualizar testes existentes ou criar novos
- Testes são entregáveis obrigatórios

---

<!-- agent-router:start -->
## TABELA DE ROTEAMENTO

🎨 **Design & UX:** @ArchitectUX, @UI-Designer, @UX-Researcher, @Brand-Guardian, @design-visual-storyteller, @Whimsy-Injector, @XR-Interface-Architect

💻 **Engineering:** @frontend-developer, @backend-architect, @senior-developer, @ai-engineer, @mobile-app-builder, @devops-automator, @rapid-prototyper, @embedded-firmware-engineer, @software-architect, @solidity-smart-contract-engineer, @voice-ai-integration-engineer, @wechat-mini-program-developer, @multi-agent-systems-architect, @minimal-change-engineer, @fable-method-agent

🗄️ **Dados & BD:** @database-optimizer, @data-engineer, @ai-data-remediation-engineer, @email-intelligence-engineer

🌐 **CMS & E-commerce:** @cms-developer, @drupal-shopping-cart-engineer, @wordpress-shopping-cart-engineer, @filament-optimization-specialist

🔧 **DevOps & Infra:** @devops-automator, @sre-site-reliability-engineer, @network-engineer, @autonomous-optimization-architect

📱 **Marketing & Growth:** @marketing-growth-hacker, @marketing-content-creator, @marketing-social-media-strategist, @marketing-twitter-engager, @marketing-instagram-curator, @marketing-tiktok-strategist, @marketing-reddit-community-builder, @App-Store-Optimizer

📋 **Produto & Projetos:** @project-manager-senior, @product-sprint-prioritizer, @product-trend-researcher, @product-feedback-synthesizer, @Experiment-Tracker, @Project-Shepherd, @Studio-Producer

🧪 **Testes & Qualidade:** @EvidenceQA, @testing-reality-checker, @API-Tester, @Performance-Benchmarker, @Test-Results-Analyzer, @code-reviewer, @codebase-onboarding-engineer, @security-agent

📝 **Suporte & Operações:** @technical-writer, @prompt-engineer, @git-workflow-master, @orgscript-engineer, @Support-Responder, @Analytics-Reporter, @incident-response-commander, @it-service-manager

📱 **Integrações:** @feishu-integration-developer, @wordpress-shopping-cart-engineer, @drupal-shopping-cart-engineer, @wechat-mini-program-developer

🔬 **Pipeline & Fable:** @AgentsOrchestrator, @fable-judge

<!-- agent-router:end -->

## 📖 SKILLS ATIVAS (GLOBAIS — `~/.agents/skills/`)

| Skill | Uso |
|---|---|
| `orchestrator-pipeline` | **Obrigatório** — Fluxo em 4 fases para toda demanda |
| `fable-method` | Loop passo-a-passo para tarefas multi-step |
| `fable-loop` | Orquestração com subagentes paralelos + verificadores |
| `fable-judge` | Verificação adversarial de trabalho concluído |
| `fable-domain` | Geração de skill bundles para novos domínios |
| `agent-reach` | Pesquisa na internet em 15 plataformas |
| `supabase-manager` | Gerenciamento do projeto Supabase NC-BOT |
| `nc-bot-release-manager` | Workflow de release do NC-Bot |

**Obrigatório:** carregar `orchestrator-pipeline` no início de cada demanda. O `fable-judge` é invocado automaticamente após toda entrega de código.

---

## 🗺️ HIERARQUIA DO PROJETO

```
D:\OpenCode\              ← Workspace raiz
├── opencode.jsonc        ← Config principal
├── AGENTS.md             ← Este arquivo
├── pipeline/             ← State machine + observabilidade + memória + context builder
├── .opencode/
│   ├── agents/           ← 38 especialistas disponíveis
│   └── skills/           ← Skills locais (projeto)
├── projeto/              ← Projetos reais
│   └── NC_BOT_OFICIAL/   ← NC-Bot
└── ...
```

**State Machine + Observabilidade + Memória + Context Builder:** `pipeline/pipeline.yaml` (estados/transições), `pipeline/state.json` (runtime), `pipeline/checklist.json` (verificação por fase), `pipeline/events.log` (eventos JSON Lines), `pipeline/metrics.json` (contadores cumulativos), `pipeline/observability.yaml` (config), `pipeline/memory.yaml` (definição do serviço), `pipeline/memory.json` (armazenamento), `pipeline/context-builder.yaml` (config).

**Skills globais:** `~/.agents/skills/` — carregadas automaticamente.
