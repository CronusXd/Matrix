# Matrix — Model Amplification Engine

**Maximize qualquer LLM com inteligência externa.**

Matrix é um middleware que amplifica o desempenho de modelos de linguagem através de classificação, planejamento, decomposição, engenharia de contexto, compilação de prompts, validação objetiva e refinamento estruturado.

## 🚀 Quick Start

```bash
npm install
npm run seed      # Gera API key inicial
npm start         # Inicia em http://127.0.0.1:3000
```

## 🔌 OpenAI-Compatible API

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer mx_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello!"}]}'
```

## 🧠 Arquitetura

```
CLIENT (OpenCode/Cline/qualquer)
  │  OpenAI-compatible API
  ▼
MATRIX GATEWAY → auth + rate limit
  │
  ▼
TASK INTELLIGENCE → classificação + complexidade + extração de objetivo
  │
  ▼
STRATEGY ENGINE → minimal | standard | deep | extreme (adaptive effort)
  │
  ▼
CONTEXT ENGINE → discovery + scoring + compression + quality gate
  │
  ▼
PROMPT COMPILER → sistema + usuário + contexto + constraints
  │
  ▼
MODEL PROFILE + ADAPTER → adapta estratégia ao perfil do modelo
  │
  ▼
PROVIDER → deepseek | openai | anthropic | openrouter
  │
  ▼
VALIDATION → tests | build | lint | result evaluator
  │
  ▼
FAILURE ANALYZER → 11 root cause categories
  │
  ▼
FEEDBACK ENGINE + REFINEMENT LOOP → max 3 iterações
  │
  ▼
CLIENT
```

## 📊 Model Gap Benchmark

Mede o quanto a Matrix amplifica o modelo:

```bash
npm run benchmark:gap
```

Métricas: Amplification Score, Model Gap, Gap Reduction.

## 📁 Estrutura

```
src/
├── server.js              ← HTTP server (Fastify)
├── routes/                ← chat, models, dashboard APIs
├── middleware/             ← auth, rate-limit
├── gateway/               ← normalizer, responder
├── providers/             ← deepseek, openai, anthropic, openrouter
├── db/                    ← SQLite (users, keys, configs)
├── intelligence/          ← Task Intelligence Engine
├── strategy/              ← 4 strategies (minimal/standard/deep/extreme)
├── context/               ← Context Engine + Quality Evaluator
├── prompt/                ← Prompt Compiler
├── model/                 ← Capability Profile + Strategy Adapter
├── validation/            ← Validator + Result Evaluator + Failure Analyzer
├── feedback/              ← Feedback Engine + Refinement Loop
└── benchmarks/            ← Model Gap Benchmark
```

## 🎯 Princípios

- **Modelo = motor de inferência.** A Matrix externaliza tudo que não é raciocínio puro.
- **Adaptive effort.** Tarefa simples = 1 call. Tarefa complexa = pipeline completo.
- **Validação objetiva.** Testes, build, lint — não LLM-as-judge.
- **Feedback estruturado.** Falhas geram diagnóstico + correção, não repetição cega.
- **Provider-agnostic.** Funciona com qualquer modelo compatível com API.

## 🔑 Segurança

- API keys hasheadas com SHA-256
- Provider keys criptografadas em repouso (AES-256-GCM)
- Rate limiting por key
- Nunca loga secrets

## 📝 Licença

MIT
