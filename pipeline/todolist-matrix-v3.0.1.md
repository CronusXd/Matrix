# Matrix v3.0.1 — Plano de Correção Arquitetural

> Criado por @fable-method-agent em 2026-07-31
> Pipeline: Fable Method Steps 0-3 (Análise Completa)
> Classificação: Task — Refactoring + Architecture — Complexidade 3 (médio)
> Especialista primário: @senior-developer

---

## Resumo Executivo

A auditoria encontrou 8 problemas (6 P0 + 2 P1) na Matrix v3.0.0. Todos foram validados
contra o código real. As correções são cirúrgicas: 8 arquivos modificados, zero novos
arquivos criados (exceto possivelmente um `qualityGate()` inline no `chat.js`).

**Done = 8 critérios:**
1. ✅ P0.1: `isAmplificationEnabled()` default = `true`
2. ✅ P0.2: Bypass `provider.chat()` removido; amplificação obrigatória ou erro `AMPLIFICATION_FAILED`
3. ✅ P0.3: Quality Gate verifica `validationScore`/`validationVerdict` antes de responder
4. ✅ P0.4: Streaming documentado com limitação conhecida (sem fake chunk)
5. ✅ P0.5: Benchmark com aviso `SYNTHETIC BENCHMARK — NOT REAL DATA`
6. ✅ P0.6: `amplificationMetrics` e `getStrategyBoost()` removidos
7. ✅ P1.1: Todos profiles com `calibrationStatus: 'uncalibrated'`
8. ✅ P1.2: Refinement loop injeta `modifiedPrompt` no adapter antes de re-chamar modelo
9. ✅ `npm test` passa com todos os testes atualizados
10. ✅ NENHUMA funcionalidade boa removida, NENHUM novo componente desnecessário

---

## Todolist — Plano de Implementação

├── 🔷 Fase A: Contrato de Amplificação (P0.1 + P0.6) — pipeline.js
│   ├── Especialista: @senior-developer
│   ├── Descrição: Fix da feature flag + remoção de métricas fabricadas. Ambas são mudanças
│   │   no mesmo arquivo (pipeline.js) e são independentes de outras fases.
│   │
│   ├── Task A.1: Alterar `isAmplificationEnabled()` para default `true`
│   │   Arquivo: `src/pipeline.js:29-31`
│   │   De: `return process.env.MATRIX_ENABLE_AMPLIFICATION === 'true';`
│   │   Para: `return process.env.MATRIX_ENABLE_AMPLIFICATION !== 'false';`
│   │   Motivo: Amplificação deve ser ON por padrão; apenas desabilitar explicitamente.
│   │
│   ├── Task A.2: Remover `amplificationMetrics` de `buildAmplifiedResponse()`
│   │   Arquivo: `src/pipeline.js:379-383`
│   │   Remover completamente o bloco `amplificationMetrics: { modelBaselineEstimate, strategyBoost, estimatedAmplification }`
│   │   Manter os demais campos do metadata (amplified, strategy, taskType, etc.)
│   │
│   ├── Task A.3: Remover função `getStrategyBoost()`
│   │   Arquivo: `src/pipeline.js:391-411`
│   │   Remover toda a função (linhas 391-411) e o JSDoc associado (linhas 389-401)
│   │
│   ├── Task A.4: Atualizar comentário no topo do arquivo
│   │   Arquivo: `src/pipeline.js:8`
│   │   De: `Feature flag: MATRIX_ENABLE_AMPLIFICATION=true (default=false)`
│   │   Para: `Feature flag: MATRIX_ENABLE_AMPLIFICATION=false (default=true)`
│   │
│   └── Verificação: `isAmplificationEnabled()` retorna `true` sem env var;
│       `buildAmplifiedResponse()` não contém `amplificationMetrics`;
│       `getStrategyBoost` não existe mais no módulo exportado.

├── 🔷 Fase B: Contrato de Entrega (P0.2 + P0.3) — chat.js
│   ├── Especialista: @senior-developer
│   ├── Descrição: Remover o bypass direto ao provider + adicionar Quality Gate antes
│   │   de entregar resposta ao cliente. Estas mudanças são acopladas: o gate impede
│   │   que respostas não validadas cheguem ao cliente.
│   │
│   ├── Task B.1: Remover fallback `provider.chat()` direto (linhas 97-103)
│   │   Arquivo: `src/routes/chat.js:96-103`
│   │   Remover o bloco:
│   │   ```
│   │   // Se amplify retornar null, cai para o fluxo normal
│   │   logger.info(...)
│   │   ```
│   │   E substituir o `} catch (ampErr) {` (linha 99) por: log do erro + retornar
│   │   erro HTTP 500 estruturado com tipo `AMPLIFICATION_FAILED`.
│   │
│   ├── Task B.2: Remover fallback direto pós-amplificação (linhas 105-125)
│   │   Arquivo: `src/routes/chat.js:105-125`
│   │   O bloco `provider.chat()` sem amplificação deve ser removido.
│   │   Se chegou aqui sem amplificação (flag desligada ou erro), retornar erro
│   │   claro ao invés de chamar o modelo diretamente.
│   │
│   ├── Task B.3: Adicionar `finalQualityGate()` antes de `formatCompletionResponse()`
│   │   Arquivo: `src/routes/chat.js:90-95` (dentro do bloco `if (amplifiedResult)`)
│   │   Antes de chamar `formatCompletionResponse()`, verificar:
│   │   - `amplifiedResult.metadata.validationVerdict` (se existir)
│   │   - `amplifiedResult.metadata.validationScore` (se existir)
│   │   - Se validationScore < 5 → retornar erro `QUALITY_GATE_FAILED` com detalhes
│   │   - Se validationScore >= 5 → proceder com resposta normal
│   │   - Se sem validação → log warning, prosseguir (não bloquear sem evidência)
│   │   Implementar como função inline no próprio chat.js (não criar novo arquivo).
│   │
│   └── Verificação: Sem `MATRIX_ENABLE_AMPLIFICATION=true`, uma requisição ao
│       `/v1/chat/completions` retorna `AMPLIFICATION_FAILED` ao invés de chamar
│       o provider direto. Com amplificação, respostas com score < 5 são bloqueadas.

├── 🔷 Fase C: Transparência de Dados (P0.5 + P0.4) — benchmark + streaming
│   ├── Especialista: @senior-developer
│   ├── Descrição: Adicionar aviso de dados sintéticos no benchmark + documentar
│   │   limitação de streaming. São arquivos separados e independentes.
│   │
│   ├── Task C.1: Adicionar aviso SYNTHETIC no benchmark
│   │   Arquivo: `src/benchmarks/model-gap-benchmark.js:2-38` (header comments)
│   │   Adicionar banner visível no topo do JSDoc:
│   │   ```
│   │   ⚠️ SYNTHETIC BENCHMARK — NOT REAL DATA
│   │   This benchmark uses deterministic pseudo-random generators (deterministicGaussian,
│   │   deterministicFloat, deterministicBool) and hardcoded QUALITY_CONFIG values.
│   │   ZERO real model calls are made. Results are illustrative only.
│   │   A real benchmark implementation with actual model calls is planned for v3.1.0.
│   │   ```
│   │   Também na função `runBenchmark()` (linha ~1212): adicionar `console.warn()`
│   │   com o mesmo aviso ao iniciar.
│   │
│   ├── Task C.2: Documentar limitação de streaming no chat.js
│   │   Arquivo: `src/routes/chat.js:158-162` (comentários do handleStreaming)
│   │   Adicionar documentação explícita:
│   │   ```
│   │   LIMITAÇÃO CONHECIDA (v3.0.1):
│   │   - Streaming NÃO passa pelo pipeline de amplificação
│   │   - A resposta é coletada completa, validada, e então streamed em chunks
│   │   - O chunking atual (20 chars, 20ms delay) é uma simulação básica
│   │   - Streaming real com SSE proxying do provider será implementado em v3.1.0
│   │   ```
│   │   NÃO remover o fake streaming agora — apenas documentar. A implementação
│   │   real de streaming requer mudanças estruturais maiores.
│   │
│   └── Verificação: `node src/benchmarks/model-gap-benchmark.js` exibe aviso
│       "SYNTHETIC BENCHMARK" no console. Comentários do streaming estão atualizados.

├── 🔷 Fase D: Calibração e Refinement (P1.1 + P1.2) — profiles + refinement-loop
│   ├── Especialista: @senior-developer
│   ├── Descrição: Adicionar calibrationStatus aos profiles + injetar modifiedPrompt
│   │   no refinement loop. São arquivos separados, mas ambos relacionados à qualidade
│   │   do pipeline de amplificação.
│   │
│   ├── Task D.1: Adicionar `calibrationStatus: 'uncalibrated'` ao DEFAULT_PROFILE
│   │   Arquivo: `src/model/profile.js:30-48` (DEFAULT_PROFILE)
│   │   Adicionar campo: `calibrationStatus: 'uncalibrated'`
│   │   Manter `verified: false` (não remover — é usado em outras partes do código)
│   │
│   ├── Task D.2: Adicionar `calibrationStatus: 'uncalibrated'` a todos KNOWN_PROFILES
│   │   Arquivo: `src/model/profile.js:69-171` (5 profiles)
│   │   Cada profile existente ganha `calibrationStatus: 'uncalibrated'`
│   │   NÃO adicionar `calibrationStatus: 'calibrated'` — todos são uncalibrated.
│   │
│   ├── Task D.3: Atualizar JSDoc do `getProfile()` para documentar calibrationStatus
│   │   Arquivo: `src/model/profile.js:178-217`
│   │   Adicionar no @returns: `calibrationStatus: 'uncalibrated'|'calibrated'`
│   │
│   ├── Task D.4: Injetar `modifiedPrompt` no refinement loop
│   │   Arquivo: `src/feedback/refinement-loop.js:107-131` (Step 1 do loop)
│   │   Problema: `executeStrategy()` é chamado sem o `modifiedPrompt` do feedback.
│   │   Correção: Após `applyFeedback()` (linha 246), extrair `modifiedPrompt` do
│   │   feedback e passá-lo como opção para a próxima iteração. Modificar a chamada
│   │   `executeStrategy()` na linha 110-112 para aceitar e usar `modifiedPrompt`
│   │   quando disponível.
│   │   Implementação:
│   │   - Na linha ~112, antes de chamar executeStrategy, verificar se
│   │     `currentContext.modifiedPrompt` existe (injetado por applyFeedbackToContext)
│   │   - Se existir, passar no options para o adapter usar como system/user prompt
│   │   - `applyFeedbackToContext()` (linha 426) já suporta `modifiedPrompt` via
│   │     `feedback.modifiedPrompt` — usar esta função dentro de `applyFeedback()`
│   │     na linha 246-250 para persistir o modifiedPrompt no contexto
│   │
│   └── Verificação: `getProfile('oc/deepseek-v4-flash-free').calibrationStatus === 'uncalibrated'`
│       Refinement loop passa `modifiedPrompt` para a próxima iteração quando disponível.

├── 🔷 Fase E: Testes e Verificação Final
│   ├── Especialista: @senior-developer (execução) + @fable-judge (verificação)
│   ├── Descrição: Atualizar testes quebrados pelas mudanças (D3.2) e executar
│   │   a suíte completa de testes para garantir que nada foi quebrado.
│   │
│   ├── Task E.1: Atualizar teste D3.2 — feature flag default
│   │   Arquivo: `test/chat-amplification.test.js:41-45`
│   │   De: `assert(isAmplificationEnabled() === false, 'D3.2: amplification disabled by default')`
│   │   Para: `assert(isAmplificationEnabled() === true, 'D3.2: amplification enabled by default')`
│   │   E adicionar teste para `MATRIX_ENABLE_AMPLIFICATION=false`:
│   │   ```
│   │   process.env.MATRIX_ENABLE_AMPLIFICATION = 'false';
│   │   assert(isAmplificationEnabled() === false, 'D3.2b: explicitly disabled');
│   │   ```
│   │
│   ├── Task E.2: Atualizar teste D3.7 — metadata sem amplificationMetrics
│   │   Arquivo: `test/chat-amplification.test.js` (verificar D3.7 — ~linha 170+)
│   │   Se o teste verifica `amplificationMetrics`, remover essa verificação.
│   │   Se o teste verifica `metadata.amplified`, manter.
│   │
│   ├── Task E.3: Atualizar teste pipeline.test.js se necessário
│   │   Arquivo: `test/pipeline.test.js`
│   │   Verificar se há referências a `getStrategyBoost` ou `amplificationMetrics`
│   │   nos testes do pipeline e remover/atualizar.
│   │
│   ├── Task E.4: Executar `npm test` e verificar todos passando
│   │   Comando: `npm test`
│   │   Esperado: 3 suites executadas (adapter, pipeline, chat-amplification),
│   │   zero falhas.
│   │
│   └── Verificação: `npm test` retorna código 0, todos os 3 arquivos de teste
│       executam sem falhas. Nenhum warning relacionado às mudanças.
```

---

## Riscos por Mudança

| Mudança | Risco | Mitigação |
|---------|-------|-----------|
| P0.1 — default true | **Baixo** — muda comportamento de inicialização | Documentar no changelog; usuários que dependiam do default false precisam setar `MATRIX_ENABLE_AMPLIFICATION=false` |
| P0.2 — remover bypass | **Médio** — se amplificação falhar, sem fallback | Quality Gate (P0.3) implementado primeiro garante que falhas são tratadas |
| P0.3 — Quality Gate | **Baixo** — adiciona verificação, não remove | Gate é permissivo sem validação (log warning, prossegue) |
| P0.4 — documentar streaming | **Nulo** — apenas comentários | N/A |
| P0.5 — aviso benchmark | **Nulo** — apenas console.warn + comentários | N/A |
| P0.6 — remover métricas | **Baixo** — remove campo do metadata | Nenhum consumidor externo conhecido que depende dessas métricas |
| P1.1 — calibrationStatus | **Nulo** — campo novo, não quebra nada | Campo aditivo |
| P1.2 — refinement loop | **Médio** — muda comportamento do loop | `applyFeedbackToContext()` já existe e suporta `modifiedPrompt`; a injeção é incremental |

---

## Ordem de Execução

```
FASE A (P0.1 + P0.6) → FASE B (P0.2 + P0.3) → FASE D (P1.1 + P1.2) → FASE C (P0.5 + P0.4) → FASE E (Testes)
```

**Justificativa:** As fases A e B são as mais críticas (P0) e devem ser feitas primeiro.
A fase D (P1) vem antes da C porque P1.2 afeta a qualidade do pipeline que P0.3 verifica.
A fase C corre em paralelo lógico (arquivos independentes) mas é executada depois por
ser menos crítica. A fase E é sempre a última.

---

## Especialista Designado

**@senior-developer** para todas as fases de implementação (A-E).
**@fable-judge** para verificação adversarial pós-Fase E.
**@code-reviewer** para revisão técnica final.

---

*Fim do plano. Entregue ao @AgentsOrchestrator para delegação.*
