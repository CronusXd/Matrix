# Changelog

Todas as mudanças notaveis neste projeto serao documentadas neste arquivo.

O formato e baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [2.0.0] — 2026-07-28

### Added

- Pipeline executor v2.0 com arquitetura modular e especialistas dedicados
- Context Builder com compressao semantica (modo `smart`), pontuacao de relevancia e eliminacao de contexto obsoleto
- Agent Router com 38 especialistas categorizados por dominio e suporte a YAML de configuracao
- Sistema de Observabilidade com registro de eventos, metricas cumulativas e tracking de agentes/ferramentas
- Memory Service com persistencia de estado, checkpoints e backup automatico
- State Machine com validacao de transicoes, historico e rollback de estados
- Fable Method integrado ao pipeline (classificacao, definicao de done, evidencias, decisao, execucao, verificacao, report)
- Fable Judge para verificacao adversarial de trabalhos concluidos com veredito (VERIFIED / CAVEATS / REFUTED / VIOLATION)
- Code Reviewer para revisao tecnica obrigatoria (corretude, seguranca, estilo, testes)
- Rollback Manager com snapshots automaticos pre-execucao e restauracao por ID
- Parallel Executor para execucao concorrente de tarefas independentes com `script:true`
- PR Generator para criacao automatica de Pull Requests no fluxo de delivery
- Model Voting para votacao entre modelos com suporte assincrono e síncrono
- SIEM Exporter para exportacao de eventos, metricas e compliance reports
- Multi-tenant com isolamento por tenant (router, estados, logs, metricas, memoria)
- Auth Gate com validacao JWT e provider externo configravel
- RAG Query com suporte a modo TF-IDF e hybrid (embeddings + TF-IDF)
- PostgreSQL Memory Adapter com fallback JSON automatico
- Documentacao em `pipeline/` com configs, templates e guias de uso

### Changed

- Migracao de arquitetura monolitica para pipeline em 4 fases com especialistas
- Fluxo de execucao agora exige verificacao obrigatoria (Judge + Code Review) antes de commit
- State machine agora le e valida pipeline.yaml, state.json, checklist.json em cada transicao
- Observabilidade separada do executor principal em modulos independentes

### Fixed

- Dependencia entre OpenTelemetry e @opentelemetry/api corrigida com fallback graceful
- Agent Router agora carrega catalogo de agentes de fonte externa (YAML) em vez de hardcoded
- Coverage gate no CI agora falha o pipeline quando thresholds nao sao atingidos

## [1.0.0] — 2026-07-26

### Added

- Pipeline basico de 4 fases (Analise, Execucao, Validacao, Revisao)
- Orchestrator central para coordenacao de agentes especialistas
- Fable Method como metodologia de resolucao de problemas (7 steps)
- Fable Judge para verificacao adversarial de entregas
- Code Reviewer para revisao tecnica de codigo
- Tabela de roteamento com 38 agentes especialistas
- Sistema de todolist para rastreamento de tarefas
- Rollback basico com snapshots
- Configuracoes iniciais do pipeline (state.json, events.log, metrics.json)

[2.0.0]: https://github.com/opencode-ai/matrix/releases/tag/v2.0.0
[1.0.0]: https://github.com/opencode-ai/matrix/releases/tag/v1.0.0
