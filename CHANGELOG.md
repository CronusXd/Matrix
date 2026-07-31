# Changelog

## [3.1.0] — 2026-07-31

### Breaking Change
- **Amplification is now ON by default.** `MATRIX_ENABLE_AMPLIFICATION` defaults to `true`.
  Set `MATRIX_ENABLE_AMPLIFICATION=false` to explicitly disable.
- **Direct provider.chat() bypass removed.** All requests now go through the amplification
  pipeline. Disabling amplification (`MATRIX_ENABLE_AMPLIFICATION=false`) now returns HTTP 503
  instead of falling back to direct model calls. This ensures the model output is always validated
  before reaching the client.

### Added
- `finalQualityGate()` in chat route — blocks responses with validation score < 5
- `calibrationStatus: 'uncalibrated'` field on all model profiles
- `verifyProfile()` and `getVerificationStatus()` functions for model profile management
- Path traversal sanitization for `projectRoot` in context gathering
- `modifiedPrompt` injection in refinement loop for smarter retries

### Removed
- `getStrategyBoost()` function — was returning fabricated amplification metrics
- `amplificationMetrics` block from `buildAmplifiedResponse()` — was synthetic data

### Fixed
- Benchmark now explicitly warns "SYNTHETIC BENCHMARK — NOT REAL DATA"
- Streaming limitations documented (bypasses amplification — known, planned for v3.2.0)

## [3.0.0] — 2026-07-31

### Added
- Model Amplification Engine — pipeline conectado ao fluxo de requisição
- Provider Adapter Bridge (`src/providers/adapter.js`) — unifica protocolo `call()` ↔ `chat()`
- Pipeline Integrator (`src/pipeline.js`) — orquestra 10 módulos de amplificação
- Feature flag `MATRIX_ENABLE_AMPLIFICATION` (default: false)
- Testes: 133 assertions (adapter, pipeline, chat-amplification)
- Context Engine cache com TTL de 5 minutos
- Model Profile verification pipeline
- Amplification Score no metadata de resposta
- projectRoot sanitization (path traversal protection)

### Architecture
- Task Intelligence — deterministic task analysis (complexity 1-5)
- Strategy Engine — 4 strategies: minimal, standard, deep, extreme
- Context Engine — CB.1-CB.6 pipeline (discovery, scoring, compression)
- Context Quality Evaluator — completeness, relevance, noise analysis
- Prompt Compiler — structured system + user prompts
- Model Capability Profile — 5 known models with capability scores
- Model Strategy Adapter — adapts strategy to model capabilities
- Validation Engine — tests, build, lint, typecheck
- Result Evaluator — SUCCESS/PARTIAL/FAILURE/DEGRADED verdict
- Failure Analyzer — 11 failure categories
- Feedback Engine — structured, actionable feedback
- Refinement Loop — max 3 iterations with feedback injection
- Provider adapters: DeepSeek, OpenAI, Anthropic, OpenRouter
- OpenAI-compatible API (`/v1/chat/completions`)
- Dashboard with API key management
- API key management: SHA-256 hashing, AES-256-GCM encryption

## [2.0.0] — 2026-07-28
*(Matrix extracted as standalone project)*

## [1.0.0] — 2026-07-26
*(Initial pipeline design)*
