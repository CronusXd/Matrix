#!/usr/bin/env node
/**
 * Model Gap Benchmark v1.0 — Matrix Model Amplification Engine
 * =============================================================
 *
 * Measures the amplification effect of the Matrix pipeline across four scenarios:
 *
 *   1. MODEL alone           — baseline performance (lower-tier model, no Matrix)
 *   2. MODEL + MATRIX        — amplified performance (lower-tier model + Matrix)
 *   3. FRONTIER alone        — upper baseline (frontier model, no Matrix)
 *   4. FRONTIER + MATRIX     — amplified upper bound (frontier model + Matrix)
 *
 * Key Metrics:
 *   Amplification Score  = quality(Model+Matrix) - quality(Model)
 *   Model Gap             = quality(Frontier) - quality(Model)
 *   Residual Gap          = quality(Frontier) - quality(Model+Matrix)
 *   Gap Reduction         = 1 - (Residual Gap / Model Gap)
 *   Gap Reduction %       = GapReduction * 100
 *
 * Task Categories (50 tasks, 5 per category):
 *   coding, debugging, refactoring, architecture, planning,
 *   research, reasoning, toolUsage, multiStep, complexRepo
 *
 * Pure Node.js — zero npm dependencies (fs, path, crypto only).
 * CommonJS module format.
 *
 * Usage:
 *   node src/benchmarks/model-gap-benchmark.js --format table
 *   node src/benchmarks/model-gap-benchmark.js --format json
 *   node src/benchmarks/model-gap-benchmark.js --format report
 *   node src/benchmarks/model-gap-benchmark.js --format all
 *   node src/benchmarks/model-gap-benchmark.js --model oc/flash --frontier oc/pro
 *   node src/benchmarks/model-gap-benchmark.js --categories coding,debugging
 *
 * Programmatic:
 *   const { runBenchmark } = require('./src/benchmarks/model-gap-benchmark');
 *   const report = await runBenchmark({ model: 'oc/flash', frontier: 'oc/pro' });
 */

/**
 * ⚠️  SYNTHETIC BENCHMARK — NOT REAL DATA  ⚠️
 * ============================================
 * This benchmark uses deterministic pseudo-random generators (deterministicGaussian,
 * deterministicFloat, deterministicBool) and hardcoded QUALITY_CONFIG values.
 * ZERO real model calls are made. Results are ILLUSTRATIVE ONLY.
 *
 * A real benchmark with actual model calls is planned for v3.1.0.
 * DO NOT cite these numbers as evidence of real amplification.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Terminal Colors ──────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m';
const C = '\x1b[36m', M = '\x1b[35m', B = '\x1b[1m', D = '\x1b[2m';
const N = '\x1b[0m';

// ─── Constants ────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'benchmark-results');

const DEFAULT_MODEL = 'oc/deepseek-v4-flash-free';
const DEFAULT_FRONTIER = 'ag/claude-sonnet-4-6';

const CATEGORIES = [
  'coding',
  'debugging',
  'refactoring',
  'architecture',
  'planning',
  'research',
  'reasoning',
  'toolUsage',
  'multiStep',
  'complexRepo'
];

// ─── Scenario Configurations ──────────────────────────────────────
const SCENARIOS = {
  model: {
    id: 'model',
    name: 'MODEL alone',
    description: 'Lower-tier model without Matrix pipeline',
    isMatrix: false,
    isFrontier: false
  },
  modelMatrix: {
    id: 'modelMatrix',
    name: 'MODEL + MATRIX',
    description: 'Lower-tier model with Matrix amplification pipeline',
    isMatrix: true,
    isFrontier: false
  },
  frontier: {
    id: 'frontier',
    name: 'FRONTIER alone',
    description: 'Frontier model without Matrix pipeline',
    isMatrix: false,
    isFrontier: true
  },
  frontierMatrix: {
    id: 'frontierMatrix',
    name: 'FRONTIER + MATRIX',
    description: 'Frontier model with Matrix amplification pipeline',
    isMatrix: true,
    isFrontier: true
  }
};

// ─── Quality Evaluation Configuration ─────────────────────────────
// Base quality parameters per scenario — used by deterministic evaluator
const QUALITY_CONFIG = {
  model: {
    baseSuccessRate: 0.30,
    baseQualityMean: 3.5,
    baseQualityStdDev: 1.2,
    baseDurationMs: 2200,
    baseLlmCalls: 1,
    baseTokensIn: 600,
    baseTokensOut: 300,
    scopeCreepRate: 0.35,
    testPassRate: 0.30,
    retriesBase: 0.2,
    costPer1KTokensIn: 0.00027,
    costPer1KTokensOut: 0.00110
  },
  modelMatrix: {
    baseSuccessRate: 0.85,
    baseQualityMean: 7.5,
    baseQualityStdDev: 0.8,
    baseDurationMs: 4800,
    baseLlmCalls: 3,
    baseTokensIn: 2200,
    baseTokensOut: 800,
    scopeCreepRate: 0.05,
    testPassRate: 0.90,
    retriesBase: 1.5,
    costPer1KTokensIn: 0.00027,
    costPer1KTokensOut: 0.00110
  },
  frontier: {
    baseSuccessRate: 0.65,
    baseQualityMean: 6.5,
    baseQualityStdDev: 1.0,
    baseDurationMs: 3200,
    baseLlmCalls: 1,
    baseTokensIn: 1200,
    baseTokensOut: 500,
    scopeCreepRate: 0.20,
    testPassRate: 0.55,
    retriesBase: 0.5,
    costPer1KTokensIn: 0.00300,
    costPer1KTokensOut: 0.01500
  },
  frontierMatrix: {
    baseSuccessRate: 0.95,
    baseQualityMean: 9.0,
    baseQualityStdDev: 0.5,
    baseDurationMs: 6000,
    baseLlmCalls: 4,
    baseTokensIn: 3000,
    baseTokensOut: 1000,
    scopeCreepRate: 0.03,
    testPassRate: 0.97,
    retriesBase: 2.0,
    costPer1KTokensIn: 0.00300,
    costPer1KTokensOut: 0.01500
  }
};

// Difficulty multiplier per category
const CATEGORY_DIFFICULTY = {
  coding:       { durMul: 1.0, qualMul: 1.0, taskCount: 5 },
  debugging:    { durMul: 1.2, qualMul: 0.85, taskCount: 5 },
  refactoring:  { durMul: 1.3, qualMul: 0.90, taskCount: 5 },
  architecture: { durMul: 1.8, qualMul: 0.70, taskCount: 5 },
  planning:     { durMul: 1.5, qualMul: 0.80, taskCount: 5 },
  research:     { durMul: 1.0, qualMul: 1.1, taskCount: 5 },
  reasoning:    { durMul: 1.0, qualMul: 0.95, taskCount: 5 },
  toolUsage:    { durMul: 1.1, qualMul: 0.90, taskCount: 5 },
  multiStep:    { durMul: 1.6, qualMul: 0.65, taskCount: 5 },
  complexRepo:  { durMul: 1.9, qualMul: 0.60, taskCount: 5 }
};

// ===================================================================
//  TASK DEFINITIONS — 50 tasks, 5 per category
// ===================================================================
const TASKS = [
  // ─── CODING (5 tasks) ───────────────────────────────────────────
  {
    id: 'CODING-001',
    category: 'coding',
    description: 'Implement a function that takes an array of numbers and returns the median value. Handle empty arrays by returning null. Include edge cases for even and odd length arrays.',
    groundTruth: {
      expectedBehavior: 'Correct median calculation for both even and odd arrays',
      expectedComplexity: 'O(n log n) or O(n)',
      edgeCases: ['empty array → null', 'single element', 'even length', 'odd length'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CODING-002',
    category: 'coding',
    description: 'Write a debounce function that delays invoking a callback until after `delay` milliseconds have elapsed since the last invocation. Return a new debounced function with a `.cancel()` method.',
    groundTruth: {
      expectedBehavior: 'Correct debounce with cancel support',
      edgeCases: ['multiple rapid calls', 'cancel before execution', 'correct this binding'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CODING-003',
    category: 'coding',
    description: 'Implement a deep clone function that correctly handles objects, arrays, Dates, RegExps, Maps, and Sets. Must handle circular references without infinite recursion.',
    groundTruth: {
      expectedBehavior: 'Deep clone with circular reference handling',
      edgeCases: ['circular objects', 'Date objects', 'Map/Set', 'RegExp'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CODING-004',
    category: 'coding',
    description: 'Create a function that parses a CSV string into an array of objects. The first row contains headers. Handle quoted fields that may contain commas, newlines, and escaped quotes.',
    groundTruth: {
      expectedBehavior: 'Correct CSV parsing with escape handling',
      edgeCases: ['quoted fields with commas', 'nested quotes', 'empty fields', 'trailing newline'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CODING-005',
    category: 'coding',
    description: 'Implement a retry utility function that executes an async function with exponential backoff. Accept maxRetries, baseDelay, and maxDelay parameters. Return the result or throw after all retries fail.',
    groundTruth: {
      expectedBehavior: 'Exponential backoff retry with configurable parameters',
      edgeCases: ['success on first try', 'success after retries', 'all retries fail', 'delay cap at maxDelay'],
      minimumQualityScore: 5
    }
  },

  // ─── DEBUGGING (5 tasks) ────────────────────────────────────────
  {
    id: 'DEBUG-001',
    category: 'debugging',
    description: 'Find and fix a race condition in an async function that fetches user data and profile data concurrently but incorrectly processes stale data when the profile request completes first.',
    groundTruth: {
      expectedBehavior: 'Correct ordering regardless of which request finishes first',
      rootCause: 'Stale closure over response variable',
      fixFiles: ['src/services/user-service.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'DEBUG-002',
    category: 'debugging',
    description: 'A React component re-renders infinitely. The useEffect depends on a value that gets updated inside the effect, creating a loop. Identify the bug and provide a fixed version.',
    groundTruth: {
      expectedBehavior: 'No infinite re-render loop',
      rootCause: 'Missing dependency array or self-referencing state update',
      fixFiles: ['src/components/Dashboard.tsx'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'DEBUG-003',
    category: 'debugging',
    description: 'Memory leak in Express.js app: event listeners are added on every request but never removed. Diagnose the leak and implement proper cleanup.',
    groundTruth: {
      expectedBehavior: 'No memory accumulation over concurrent requests',
      rootCause: 'Missing removeListener or once option',
      fixFiles: ['src/middleware/request-logger.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'DEBUG-004',
    category: 'debugging',
    description: 'A sorting function returns incorrect results for arrays containing negative numbers. The comparison function has a subtle numeric vs string coercion bug. Find and fix.',
    groundTruth: {
      expectedBehavior: 'Correct sorting for all number types including negatives',
      rootCause: 'String comparison instead of numeric (e.g., a - b vs a > b)',
      fixFiles: ['src/utils/sort.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'DEBUG-005',
    category: 'debugging',
    description: 'SQL query with JOIN is producing duplicate rows. The query lacks proper GROUP BY or uses the wrong JOIN type. Rewrite the query to return unique records per user.',
    groundTruth: {
      expectedBehavior: 'One row per user with aggregated data',
      rootCause: 'Missing DISTINCT or incorrect JOIN condition',
      fixFiles: ['src/db/queries/user-orders.ts'],
      minimumQualityScore: 5
    }
  },

  // ─── REFACTORING (5 tasks) ───────────────────────────────────────
  {
    id: 'REFACTOR-001',
    category: 'refactoring',
    description: 'Refactor a 300-line function that handles order processing, payment validation, inventory check, notification sending, and receipt generation into smaller, testable modules.',
    groundTruth: {
      expectedBehavior: 'Same functionality, split into 4-6 focused modules',
      newFiles: ['src/orders/process.ts', 'src/orders/payment.ts', 'src/orders/inventory.ts', 'src/orders/notify.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REFACTOR-002',
    category: 'refactoring',
    description: 'Replace a chain of 15 nested if/else statements in a discount calculator with a strategy pattern. Each discount rule should be a separate class implementing a common interface.',
    groundTruth: {
      expectedBehavior: 'Identical discount calculations, extensible rule system',
      newFiles: ['src/pricing/DiscountStrategy.ts', 'src/pricing/rules/*.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REFACTOR-003',
    category: 'refactoring',
    description: 'Convert a callback-based file processing pipeline with 5 nested callbacks (callback hell) into a Promise-based or async/await equivalent, preserving error handling.',
    groundTruth: {
      expectedBehavior: 'Same file processing, flat async/await structure',
      changedFiles: ['src/processors/file-pipeline.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REFACTOR-004',
    category: 'refactoring',
    description: 'A configuration object with 40+ flat keys is used throughout the codebase. Refactor into a nested, namespaced structure (database.*, cache.*, logging.*, api.*) and update all references.',
    groundTruth: {
      expectedBehavior: 'Backward-compatible config access via namespaced structure',
      changedFiles: ['src/config/index.ts', 'src/config/types.ts'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REFACTOR-005',
    category: 'refactoring',
    description: 'Extract duplicated validation logic found across 6 different route handlers into a shared middleware/validator module. The validators should be composable and type-safe.',
    groundTruth: {
      expectedBehavior: 'Single source of truth for validation, all routes use shared validators',
      newFiles: ['src/validators/index.ts'],
      changedFiles: ['src/routes/*.ts'],
      minimumQualityScore: 5
    }
  },

  // ─── ARCHITECTURE (5 tasks) ──────────────────────────────────────
  {
    id: 'ARCH-001',
    category: 'architecture',
    description: 'Design a microservices decomposition plan for a monolithic e-commerce app with 500K daily users. Identify bounded contexts, data ownership boundaries, and communication patterns (sync vs async).',
    groundTruth: {
      expectedBehavior: 'Clear bounded contexts: orders, inventory, users, payments, notifications',
      keyConcepts: ['event-driven communication', 'database per service', 'API gateway'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'ARCH-002',
    category: 'architecture',
    description: 'Design a real-time collaborative document editing system (like Google Docs). Address conflict resolution, operational transformation or CRDT, websocket vs polling, and offline support.',
    groundTruth: {
      expectedBehavior: 'Feature-complete architecture with conflict resolution strategy',
      keyConcepts: ['CRDT or OT', 'websocket channels', 'offline queue', 'merge strategy'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'ARCH-003',
    category: 'architecture',
    description: 'Propose an architecture for a rate limiting system that handles 1M requests/second across 50 distributed API gateways. Must be eventually consistent, low latency (< 1ms overhead), and survive node failures.',
    groundTruth: {
      expectedBehavior: 'Distributed rate limiter with configurable limits per client',
      keyConcepts: ['sliding window', 'Redis cluster', 'eventual consistency', 'local + global counters'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'ARCH-004',
    category: 'architecture',
    description: 'Design the data pipeline architecture for processing 10TB/day of event logs into an analytics warehouse. Include ingestion, transformation, storage tiers (hot/warm/cold), and query optimization.',
    groundTruth: {
      expectedBehavior: 'Scalable pipeline with partition strategy and retention policies',
      keyConcepts: ['Kafka/streaming', 'batch processing', 'columnar storage', 'partitioning'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'ARCH-005',
    category: 'architecture',
    description: 'Design a multi-tenant SaaS application architecture. Address tenant isolation, database strategy (separate DB vs shared DB with RLS), custom domains, and per-tenant feature flags.',
    groundTruth: {
      expectedBehavior: 'Complete multi-tenant architecture with security isolation',
      keyConcepts: ['tenant isolation', 'RLS or schema-per-tenant', 'feature flags', 'custom domain routing'],
      minimumQualityScore: 5
    }
  },

  // ─── PLANNING (5 tasks) ─────────────────────────────────────────
  {
    id: 'PLAN-001',
    category: 'planning',
    description: 'Create a detailed implementation plan for migrating a legacy PHP monolith to a modern Node.js microservices architecture over 6 months. Include phases, milestones, risk mitigation, and rollback strategy.',
    groundTruth: {
      expectedBehavior: 'Phased migration plan with strangler fig pattern',
      keyDeliverables: ['timeline', 'phase breakdown', 'risk matrix', 'rollback strategy'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'PLAN-002',
    category: 'planning',
    description: 'Create a sprint plan for implementing a new payment gateway integration (Stripe) with tokenization, webhook handling, idempotency, and PCI compliance. Break down into 2-week sprints over 8 weeks.',
    groundTruth: {
      expectedBehavior: 'Detailed sprint plan with dependencies and acceptance criteria',
      keyDeliverables: ['sprint breakdown', 'API design', 'test plan', 'PCI checklist'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'PLAN-003',
    category: 'planning',
    description: 'Create a release checklist and rollout plan for a critical production deployment affecting 2M users. Include canary deployment, feature flags, monitoring dashboards, on-call rotation, and rollback triggers.',
    groundTruth: {
      expectedBehavior: 'Complete release plan with observability and rollback triggers',
      keyDeliverables: ['canary strategy', 'monitoring plan', 'rollback criteria', 'comm plan'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'PLAN-004',
    category: 'planning',
    description: 'Break down the task "Add real-time notifications to the platform" into granular, assignable tickets with story points, dependencies, and acceptance criteria. Assume a team of 4 engineers.',
    groundTruth: {
      expectedBehavior: 'Task breakdown with clear dependencies and estimates',
      keyDeliverables: ['epic breakdown', 'story point estimates', 'dependency graph', 'acceptance criteria'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'PLAN-005',
    category: 'planning',
    description: 'Create a capacity planning document for scaling the API layer from 10K to 500K concurrent users. Include load testing strategy, auto-scaling rules, database connection pooling, and cache warming.',
    groundTruth: {
      expectedBehavior: 'Data-backed scaling plan with resource estimates',
      keyDeliverables: ['load projections', 'auto-scaling config', 'connection pool tuning', 'cache strategy'],
      minimumQualityScore: 5
    }
  },

  // ─── RESEARCH (5 tasks) ──────────────────────────────────────────
  {
    id: 'RSCH-001',
    category: 'research',
    description: 'Research and compare three embedded vector database solutions (SQLite-vec, LanceDB, DuckDB) for local-first AI applications. Evaluate on: index speed, query latency, memory usage, and ease of integration with Node.js.',
    groundTruth: {
      expectedBehavior: 'Comparison table with quantitative benchmarks',
      keyAreas: ['benchmark results', 'integration effort', 'platform support', 'community activity'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'RSCH-002',
    category: 'research',
    description: 'Research the state of WebAssembly in 2026 for server-side applications. Compare WASM runtimes (Wasmtime, Wasmer, WasmEdge) on cold start time, throughput, and language support for Go, Rust, and TypeScript.',
    groundTruth: {
      expectedBehavior: 'Current (2026) landscape analysis with benchmark data',
      keyAreas: ['runtime comparison', 'language ecosystem', 'cold start benchmarks', 'production readiness'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'RSCH-003',
    category: 'research',
    description: 'Investigate best practices for observability in a microservices environment. Compare OpenTelemetry vs proprietary solutions (Datadog, New Relic) on cost, complexity, and feature coverage for traces, metrics, and logs.',
    groundTruth: {
      expectedBehavior: 'Cost-benefit analysis with implementation complexity estimates',
      keyAreas: ['OpenTelemetry setup', 'vendor lock-in risks', 'sampling strategies', 'cost at scale'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'RSCH-004',
    category: 'research',
    description: 'Research the current landscape of TypeScript ORMs beyond Prisma and Drizzle. Evaluate Kysely, MikroORM, and TypeORM on type safety, query performance, migration support, and developer experience.',
    groundTruth: {
      expectedBehavior: 'Comprehensive comparison with code examples',
      keyAreas: ['type safety score', 'query benchmarks', 'migration workflow', 'learning curve'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'RSCH-005',
    category: 'research',
    description: 'Research strategies for reducing LLM API costs in production. Compare prompt caching, semantic caching, batching, model distillation, speculative decoding, and embedding-based filtering.',
    groundTruth: {
      expectedBehavior: 'Cost comparison table with practical implementation guidance',
      keyAreas: ['cost savings %', 'implementation effort', 'latency impact', 'quality impact'],
      minimumQualityScore: 5
    }
  },

  // ─── REASONING (5 tasks) ────────────────────────────────────────
  {
    id: 'REAS-001',
    category: 'reasoning',
    description: 'Analyze the trade-offs between SQL and NoSQL for a social media feed with nested comments, likes, and real-time updates. Consider read/write patterns, schema flexibility, and query complexity. Recommend one with justification.',
    groundTruth: {
      expectedBehavior: 'Thorough trade-off analysis with data model examples',
      keyConsiderations: ['read vs write ratio', 'query patterns', 'schema evolution', 'consistency needs'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REAS-002',
    category: 'reasoning',
    description: 'Evaluate whether to use server-side rendering (SSR), static site generation (SSG), or client-side rendering (CSR) for a documentation site with 5000 pages that updates daily. Consider SEO, build time, CDN caching, and DX.',
    groundTruth: {
      expectedBehavior: 'Decision matrix with weighted criteria',
      keyConsiderations: ['SEO requirements', 'build time budget', 'update frequency', 'cache strategy'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REAS-003',
    category: 'reasoning',
    description: 'A startup must decide between building on AWS Lambda (serverless) vs ECS Fargate (containerized) for a real-time chat backend. Analyze cold starts, cost at scale, operational overhead, and WebSocket support.',
    groundTruth: {
      expectedBehavior: 'Cost and performance analysis for each option at different scales',
      keyConsiderations: ['cold start latency', 'WebSocket handling', 'cost at 10/100/1000 concurrent connections', 'debugging'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REAS-004',
    category: 'reasoning',
    description: 'Given a distributed system experiencing intermittent data inconsistency, reason through the likely root causes. Consider network partitions, clock skew, eventual consistency races, and leader election bugs.',
    groundTruth: {
      expectedBehavior: 'Differential diagnosis with probability estimates for each cause',
      keyConsiderations: ['CAP theorem implications', 'clock drift impact', 'quorum configuration', 'leader election timeout'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'REAS-005',
    category: 'reasoning',
    description: 'Compare monolithic vs microservices architecture for a team of 8 engineers building a B2B SaaS. Consider: deployment frequency, debugging complexity, onboarding speed, performance overhead, and long-term maintainability.',
    groundTruth: {
      expectedBehavior: 'Context-aware recommendation with team-size-adjusted analysis',
      keyConsiderations: ['team size impact', 'cognitive load', 'deployment independence', 'inter-service debugging'],
      minimumQualityScore: 5
    }
  },

  // ─── TOOL USAGE (5 tasks) ──────────────────────────────────────
  {
    id: 'TOOL-001',
    category: 'toolUsage',
    description: 'Write a shell script that finds all TypeScript files with console.log statements, replaces them with a proper logging library call, and commits to git with a descriptive message. Use `rg` (ripgrep), `sed`, and `git`.',
    groundTruth: {
      expectedBehavior: 'Script correctly finds, replaces, and commits only modified files',
      edgeCases: ['files with no console.log', 'files matching string literals containing "console.log"'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'TOOL-002',
    category: 'toolUsage',
    description: 'Use git bisect to find the commit that introduced a bug where login returns 500. The known good tag is v2.4.0 and the bad tag is v2.5.0. Document the bisect steps and identify the specific commit hash and its changes.',
    groundTruth: {
      expectedBehavior: 'Correct bisect procedure with identified commit',
      expectedOutput: ['bisect start', 'good/bad marking', 'identified commit', 'commit diff analysis'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'TOOL-003',
    category: 'toolUsage',
    description: 'Create a Dockerfile for a Node.js 22 application using multi-stage builds. The prod stage should be minimal (distroless or alpine-slim). Include proper layer caching, non-root user, and healthcheck.',
    groundTruth: {
      expectedBehavior: 'Production-ready multi-stage Dockerfile with security best practices',
      keyFeatures: ['multi-stage build', 'non-root USER', 'HEALTHCHECK', 'layer caching optimization'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'TOOL-004',
    category: 'toolUsage',
    description: 'Write a GitHub Actions workflow that runs on pull requests to main. It should: install deps (with caching), lint, type-check, run tests with coverage, and comment the coverage diff on the PR. Fail if coverage drops.',
    groundTruth: {
      expectedBehavior: 'Complete CI workflow with PR coverage comment',
      keyFeatures: ['npm ci with cache', 'parallel lint/typecheck/test', 'coverage threshold', 'PR comment'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'TOOL-005',
    category: 'toolUsage',
    description: 'Configure ESLint flat config (eslint.config.js) for a TypeScript monorepo with 3 packages. Include rules for: import order, no console in production code, prefer const, and type-aware rules from typescript-eslint.',
    groundTruth: {
      expectedBehavior: 'Working eslint.config.js flat config for monorepo',
      keyFeatures: ['flat config format', 'typescript-eslint integration', 'import sorting', 'monorepo-aware'],
      minimumQualityScore: 5
    }
  },

  // ─── MULTI-STEP (5 tasks) ──────────────────────────────────────
  {
    id: 'MULTI-001',
    category: 'multiStep',
    description: '(Step 1/3) Create a REST API endpoint POST /api/orders that validates input with Zod. (Step 2/3) Implement the order creation logic with inventory check and payment processing. (Step 3/3) Add idempotency key support and write integration tests.',
    groundTruth: {
      expectedBehavior: 'All 3 steps completed with working tests',
      dependencies: ['Step 1 → Step 2 → Step 3'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'MULTI-002',
    category: 'multiStep',
    description: '(Step 1/4) Set up a PostgreSQL database schema with users, posts, and comments tables. (Step 2/4) Create migration files and a seed script. (Step 3/4) Build the repository layer with unit tests. (Step 4/4) Create a CLI tool to query the top 10 most commented posts.',
    groundTruth: {
      expectedBehavior: 'Complete end-to-end: schema → migrations → repositories → CLI',
      dependencies: ['Step 1 → Step 2 → Step 3 → Step 4'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'MULTI-003',
    category: 'multiStep',
    description: '(Step 1/3) Implement user authentication with JWT + refresh token rotation. (Step 2/3) Add role-based authorization middleware. (Step 3/3) Write end-to-end tests covering login, token refresh, and protected route access.',
    groundTruth: {
      expectedBehavior: 'Full auth flow with tests for all scenarios',
      dependencies: ['Step 1 → Step 2 → Step 3'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'MULTI-004',
    category: 'multiStep',
    description: '(Step 1/4) Set up a WebSocket server using the ws library. (Step 2/4) Implement a simple chat room with join/leave/broadcast. (Step 3/4) Add message persistence to SQLite. (Step 4/4) Add reconnection logic on the client with exponential backoff.',
    groundTruth: {
      expectedBehavior: 'Working WebSocket chat with persistence and reconnection',
      dependencies: ['Step 1 → Step 2 → Step 3; Step 4 can follow 2'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'MULTI-005',
    category: 'multiStep',
    description: '(Step 1/3) Create a CLI task runner tool similar to npm scripts but with parallel execution. (Step 2/3) Add support for task dependencies and a DAG resolver. (Step 3/3) Add a --watch mode that re-runs tasks on file changes using chokidar.',
    groundTruth: {
      expectedBehavior: 'Functional task runner with DAG resolution and watch mode',
      dependencies: ['Step 1 → Step 2 → Step 3'],
      minimumQualityScore: 5
    }
  },

  // ─── COMPLEX REPO (5 tasks) ──────────────────────────────────────
  {
    id: 'CREPO-001',
    category: 'complexRepo',
    description: 'In a large monorepo with 15 packages, find all circular dependencies between packages and propose a refactoring plan to break each cycle. Use `madge` or manual analysis of the dependency graph.',
    groundTruth: {
      expectedBehavior: 'List of all circular dependencies with refactoring recommendations',
      keyDeliverables: ['dependency graph', 'circular dependency list', 'break strategy per cycle'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CREPO-002',
    category: 'complexRepo',
    description: 'Audit a legacy Express.js app (200+ routes) for security vulnerabilities: missing input validation, SQL injection vectors, XSS in templates, and missing CSRF protection. Prioritize findings by severity.',
    groundTruth: {
      expectedBehavior: 'Security audit report with prioritized findings',
      keyDeliverables: ['vulnerability list', 'severity classification', 'fix recommendations', 'affected routes'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CREPO-003',
    category: 'complexRepo',
    description: 'Profile a Node.js backend with 99th percentile latency of 2 seconds. Use clinic.js or similar to identify: event loop blockers, slow database queries, high garbage collection pauses, and unbounded promise chains.',
    groundTruth: {
      expectedBehavior: 'Performance profile with identified bottlenecks and fix suggestions',
      keyDeliverables: ['flame graph analysis', 'slow query identification', 'GC pause metrics', 'optimization plan'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CREPO-004',
    category: 'complexRepo',
    description: 'Given a TypeScript project with 50K lines and no tests, create a test strategy: which modules to test first (risk-based), unit vs integration split, mock strategy for external services, and target coverage goals per module.',
    groundTruth: {
      expectedBehavior: 'Risk-prioritized test strategy document',
      keyDeliverables: ['module risk matrix', 'test type allocation', 'mock strategy', 'coverage targets'],
      minimumQualityScore: 5
    }
  },
  {
    id: 'CREPO-005',
    category: 'complexRepo',
    description: 'Analyze a project with 300 npm dependencies. Identify: outdated packages with known CVEs, unused dependencies, packages that can be replaced with built-in Node.js APIs, and dependency size optimization opportunities.',
    groundTruth: {
      expectedBehavior: 'Dependency audit with actionable cleanup recommendations',
      keyDeliverables: ['CVE list', 'unused deps', 'native replacements', 'size optimization', 'upgrade path'],
      minimumQualityScore: 5
    }
  }
];

// ===================================================================
//  UTILITY FUNCTIONS
// ===================================================================

/**
 * Deterministic hash function for reproducibility.
 * @param {string} str - Input string
 * @returns {number} 32-bit integer hash
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}

/**
 * Returns a deterministic float in [0, 1) based on a seed string.
 * @param {string} seed - Seed string
 * @returns {number} Value between 0 and 1
 */
function deterministicFloat(seed) {
  const buf = crypto.createHash('md5').update(seed).digest();
  // Use first 4 bytes as a fraction
  const intVal = buf.readUInt32BE(0);
  return intVal / 0xFFFFFFFF;
}

/**
 * Returns a deterministic boolean based on threshold.
 * @param {string} seed - Seed string
 * @param {number} prob - Probability threshold (0-1)
 * @returns {boolean}
 */
function deterministicBool(seed, prob) {
  return deterministicFloat(seed) < prob;
}

/**
 * Deterministic gaussian-like value using Box-Muller on hashed seeds.
 * @param {string} seed - Seed string
 * @param {number} mean - Mean value
 * @param {number} stdDev - Standard deviation
 * @returns {number}
 */
function deterministicGaussian(seed, mean, stdDev) {
  const u1 = Math.max(0.001, deterministicFloat(seed + ':u1'));
  const u2 = deterministicFloat(seed + ':u2');
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Clamps a value between min and max.
 * @param {number} val - Value to clamp
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Rounds a number to N decimal places.
 * @param {number} val - Value
 * @param {number} decimals - Decimal places
 * @returns {number}
 */
function roundTo(val, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Calculates the average of an array.
 * @param {number[]} arr - Array of numbers
 * @returns {number}
 */
function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Calculates the standard deviation of an array.
 * @param {number[]} arr - Array of numbers
 * @returns {number}
 */
function stddev(arr) {
  if (!arr || arr.length < 2) return 0;
  const mean = avg(arr);
  const sq = arr.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

/**
 * Calculates the median of an array.
 * @param {number[]} arr - Array of numbers
 * @returns {number}
 */
function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Formats milliseconds into a human-readable duration.
 * @param {number} ms - Milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return mins + 'm ' + secs + 's';
}

// ===================================================================
//  QUALITY EVALUATION ENGINE
// ===================================================================

/**
 * Evaluates a single task in a given scenario using deterministic
 * quality heuristics. Returns a complete result object.
 *
 * @param {Object} task - Task definition
 * @param {Object} scenarioConfig - QUALITY_CONFIG[scenarioId]
 * @param {Object} scenarioMeta - SCENARIOS[scenarioId] metadata
 * @returns {Object} Task result
 */
function evaluateTask(task, scenarioConfig, scenarioMeta) {
  const catDiff = CATEGORY_DIFFICULTY[task.category] || { durMul: 1.0, qualMul: 1.0 };
  const seed = task.id + ':' + scenarioMeta.id + ':v1';

  // Success probability
  const successProb = scenarioConfig.baseSuccessRate * catDiff.qualMul;
  const success = deterministicBool(seed + ':success', successProb);

  // Quality score (0-10)
  let quality;
  if (success) {
    const raw = deterministicGaussian(seed + ':qual',
      scenarioConfig.baseQualityMean * catDiff.qualMul,
      scenarioConfig.baseQualityStdDev);
    quality = clamp(raw, 5.0, 10.0);
  } else {
    const raw = deterministicGaussian(seed + ':qual',
      scenarioConfig.baseQualityMean * 0.5 * catDiff.qualMul,
      scenarioConfig.baseQualityStdDev * 1.5);
    quality = clamp(raw, 0.0, 5.0);
  }
  quality = roundTo(quality, 2);

  // Attempts (how many tries the agent took)
  const retries = success
    ? Math.max(0, Math.round(deterministicGaussian(seed + ':retries', scenarioConfig.retriesBase, 0.5)))
    : Math.max(0, Math.round(deterministicGaussian(seed + ':retries', scenarioConfig.retriesBase * 0.5, 0.3)));
  const attempts = 1 + retries;

  // Model calls (distinct LLM invocations)
  const modelCalls = Math.max(1, Math.round(deterministicGaussian(seed + ':calls',
    scenarioConfig.baseLlmCalls * catDiff.durMul, 1.0)));

  // Tokens
  const tokensIn = Math.max(50, Math.round(deterministicGaussian(seed + ':tkin',
    scenarioConfig.baseTokensIn * catDiff.durMul, scenarioConfig.baseTokensIn * 0.3)));
  const tokensOut = Math.max(30, Math.round(deterministicGaussian(seed + ':tkout',
    scenarioConfig.baseTokensOut * catDiff.durMul, scenarioConfig.baseTokensOut * 0.3)));

  // Cost
  const cost = roundTo(
    (tokensIn / 1000) * scenarioConfig.costPer1KTokensIn +
    (tokensOut / 1000) * scenarioConfig.costPer1KTokensOut,
    6
  );

  // Latency
  const latencyMs = Math.max(100, Math.round(deterministicGaussian(seed + ':latency',
    scenarioConfig.baseDurationMs * catDiff.durMul, scenarioConfig.baseDurationMs * 0.25)));

  // Scope creep
  const scopeCreep = !success
    ? deterministicBool(seed + ':scope', 0.5)
    : deterministicBool(seed + ':scope', scenarioConfig.scopeCreepRate);

  // Tests
  const testsTotal = 5 + Math.floor(hashCode(task.id) % 6); // 5-10 tests
  const testPassProb = success ? scenarioConfig.testPassRate : 0.1;
  const testsPassed = Math.round(testsTotal * deterministicFloat(seed + ':tests') * testPassProb);
  const testsFailed = testsTotal - testsPassed;

  // Errors
  const errors = [];
  if (!success) {
    const errPool = [
      'Syntax error in generated code',
      'Missing edge case handling',
      'Incorrect API usage',
      'Type mismatch error',
      'Unhandled promise rejection',
      'Null reference exception',
      'Incorrect algorithm implementation',
      'Breaking existing functionality'
    ];
    const numErrors = clamp(Math.floor(deterministicFloat(seed + ':errs') * 4), 1, 3);
    for (let i = 0; i < numErrors; i++) {
      const errIdx = Math.abs(hashCode(seed + ':err' + i)) % errPool.length;
      errors.push(errPool[errIdx]);
    }
  }

  // Ground truth checks
  const gt = task.groundTruth || {};
  const minScore = (gt.minimumQualityScore || 5);
  const meetsMinimum = quality >= minScore;

  return {
    taskId: task.id,
    category: task.category,
    description: task.description.substring(0, 80) + (task.description.length > 80 ? '...' : ''),
    scenario: scenarioMeta.id,
    scenarioName: scenarioMeta.name,
    success,
    qualityScore: quality,
    meetsMinimum,
    attempts,
    modelCalls,
    tokens: {
      input: tokensIn,
      output: tokensOut,
      total: tokensIn + tokensOut
    },
    latencyMs,
    cost,
    testsPassed: testsPassed,
    testsTotal,
    testsFailed,
    scopeCreep,
    errors
  };
}

// ===================================================================
//  AGGREGATE METRICS CALCULATION
// ===================================================================

/**
 * Computes aggregate metrics from a set of task results.
 * @param {Object[]} results - Array of task results for one scenario
 * @returns {Object} Summary statistics
 */
function computeSummary(results) {
  if (!results || results.length === 0) {
    return {
      totalTasks: 0,
      successCount: 0,
      failCount: 0,
      successRate: 0,
      avgQuality: 0,
      medianQuality: 0,
      stddevQuality: 0,
      minQuality: 0,
      maxQuality: 0,
      avgLatency: 0,
      totalLatency: 0,
      avgModelCalls: 0,
      totalTokens: 0,
      avgTokens: 0,
      totalCost: 0,
      avgCost: 0,
      testPassRate: 0,
      scopeCreepRate: 0,
      totalErrors: 0,
      qualityByCategory: {}
    };
  }

  const successResults = results.filter(r => r.success);
  const qualityScores = results.map(r => r.qualityScore);
  const qualitySorted = qualityScores.slice().sort((a, b) => a - b);

  // Quality by category
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r.qualityScore);
  }
  const qualityByCategory = {};
  for (const [cat, scores] of Object.entries(byCategory)) {
    qualityByCategory[cat] = roundTo(avg(scores), 2);
  }

  return {
    totalTasks: results.length,
    successCount: successResults.length,
    failCount: results.length - successResults.length,
    successRate: roundTo(successResults.length / results.length, 4),
    avgQuality: roundTo(avg(qualityScores), 2),
    medianQuality: roundTo(median(qualityScores), 2),
    stddevQuality: roundTo(stddev(qualityScores), 2),
    minQuality: roundTo(Math.min(...qualityScores), 2),
    maxQuality: roundTo(Math.max(...qualityScores), 2),
    avgLatency: Math.round(avg(results.map(r => r.latencyMs))),
    totalLatency: results.reduce((s, r) => s + r.latencyMs, 0),
    avgModelCalls: roundTo(avg(results.map(r => r.modelCalls)), 2),
    totalTokens: results.reduce((s, r) => s + r.tokens.total, 0),
    avgTokens: Math.round(avg(results.map(r => r.tokens.total))),
    totalCost: roundTo(results.reduce((s, r) => s + r.cost, 0), 6),
    avgCost: roundTo(avg(results.map(r => r.cost)), 6),
    testPassRate: roundTo(
      results.reduce((s, r) => s + r.testsPassed, 0) /
      Math.max(1, results.reduce((s, r) => s + r.testsTotal, 0)),
      4
    ),
    scopeCreepRate: roundTo(results.filter(r => r.scopeCreep).length / results.length, 4),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
    qualityByCategory
  };
}

/**
 * Calculates the key amplification metrics across scenarios.
 * @param {Object} summaries - { model, modelMatrix, frontier, frontierMatrix }
 * @returns {Object} Amplification metrics
 */
function calculateMetrics(summaries) {
  const model = summaries.model || {};
  const modelMatrix = summaries.modelMatrix || {};
  const frontier = summaries.frontier || {};
  const frontierMatrix = summaries.frontierMatrix || {};

  const modelQuality = model.avgQuality || 0;
  const modelMatrixQuality = modelMatrix.avgQuality || 0;
  const frontierQuality = frontier.avgQuality || 0;
  const frontierMatrixQuality = frontierMatrix.avgQuality || 0;

  // Core amplification metrics
  const amplificationScore = roundTo(modelMatrixQuality - modelQuality, 2);
  const amplificationPercent = modelQuality > 0
    ? roundTo(((modelMatrixQuality - modelQuality) / modelQuality) * 100, 1)
    : 0;

  const modelGap = roundTo(frontierQuality - modelQuality, 2);
  const residualGap = roundTo(frontierQuality - modelMatrixQuality, 2);
  const gapReduction = modelGap > 0
    ? roundTo(1 - (residualGap / modelGap), 4)
    : 0;
  const gapReductionPercent = roundTo(gapReduction * 100, 1);

  // Frontier amplification
  const frontierAmplificationScore = roundTo(frontierMatrixQuality - frontierQuality, 2);

  // Success rate improvements
  const successRateGain = roundTo((modelMatrix.successRate || 0) - (model.successRate || 0), 4);

  // Cost efficiency
  const costPerQualityPoint = modelMatrix.avgQuality > 0
    ? roundTo(modelMatrix.avgCost / modelMatrix.avgQuality, 6)
    : 0;

  // Latency overhead
  const averageOverheadMs = (modelMatrix.avgLatency || 0) - (model.avgLatency || 0);
  const overheadPercent = model.avgLatency > 0
    ? roundTo((averageOverheadMs / model.avgLatency) * 100, 1)
    : 0;

  // Scope creep reduction
  const scopeCreepReduction = model.scopeCreepRate > 0
    ? roundTo(((model.scopeCreepRate - modelMatrix.scopeCreepRate) / model.scopeCreepRate) * 100, 1)
    : 0;

  return {
    amplificationScore,
    amplificationPercent,
    modelGap,
    residualGap,
    gapReduction,
    gapReductionPercent,
    frontierAmplificationScore,
    successRateGain,
    costPerQualityPoint,
    averageOverheadMs,
    overheadPercent,
    scopeCreepReduction,
    // Interpretation
    interpretation: interpretResults({
      amplificationScore,
      gapReductionPercent,
      residualGap,
      modelQuality,
      modelMatrixQuality,
      frontierQuality,
      frontierMatrixQuality
    })
  };
}

/**
 * Generates human-readable interpretation of benchmark results.
 * @param {Object} metrics - Core metrics
 * @returns {string}
 */
function interpretResults(metrics) {
  const lines = [];

  if (metrics.gapReductionPercent >= 80) {
    lines.push(`Matrix NEARLY ELIMINATES the model gap (${metrics.gapReductionPercent}% reduction). The lower-tier model with Matrix` +
      ` (quality: ${metrics.modelMatrixQuality}) approaches or exceeds the frontier model alone (quality: ${metrics.frontierQuality}).`);
  } else if (metrics.gapReductionPercent >= 50) {
    lines.push(`Matrix SIGNIFICANTLY REDUCES the model gap (${metrics.gapReductionPercent}% reduction). The lower-tier model` +
      ` with Matrix (quality: ${metrics.modelMatrixQuality}) closes more than half the gap to the frontier (quality: ${metrics.frontierQuality}).`);
  } else if (metrics.gapReductionPercent > 0) {
    lines.push(`Matrix PARTIALLY REDUCES the model gap (${metrics.gapReductionPercent}% reduction). There is still room for` +
      ` improvement to fully close the gap.`);
  } else {
    lines.push(`Matrix does not measurably close the model gap in this configuration. The pipeline may need tuning.`);
  }

  if (metrics.amplificationScore > 2) {
    lines.push(`Amplification score is STRONG (+${metrics.amplificationScore.toFixed(1)} points). Using Matrix on the lower-tier` +
      ` model provides substantial quality improvement.`);
  } else if (metrics.amplificationScore > 0.5) {
    lines.push(`Amplification score is MODERATE (+${metrics.amplificationScore.toFixed(1)} points). Matrix provides a measurable` +
      ` but moderate boost to the lower-tier model.`);
  } else {
    lines.push(`Amplification score is MARGINAL (+${metrics.amplificationScore.toFixed(1)} points). Evaluate whether the cost/time` +
      ` overhead justifies the quality improvement.`);
  }

  return lines.join('\n');
}

// ===================================================================
//  PER-TASK COMPARISON TABLE
// ===================================================================

/**
 * Builds a per-task comparison across all scenarios.
 * @param {Object} allResults - { model, modelMatrix, frontier, frontierMatrix }
 * @returns {Object[]} Task comparison array
 */
function buildTaskComparison(allResults) {
  const byTask = {};
  for (const [scenarioId, results] of Object.entries(allResults)) {
    for (const r of results) {
      if (!byTask[r.taskId]) byTask[r.taskId] = {};
      byTask[r.taskId][scenarioId] = r;
    }
  }

  const comparison = [];
  for (const [taskId, scenarios] of Object.entries(byTask)) {
    const entry = { taskId };
    const cats = new Set();
    for (const [sid, result] of Object.entries(scenarios)) {
      entry['quality_' + sid] = result.qualityScore;
      entry['success_' + sid] = result.success;
      entry['latency_' + sid] = result.latencyMs;
      entry['scope_' + sid] = result.scopeCreep;
      cats.add(result.category);
    }

    // Calculate deltas
    if (scenarios.model && scenarios.modelMatrix) {
      entry.delta_amplification = roundTo(
        scenarios.modelMatrix.qualityScore - scenarios.model.qualityScore, 2
      );
    }

    entry.category = [...cats][0] || 'unknown';
    comparison.push(entry);
  }

  return comparison;
}

// ===================================================================
//  MAIN BENCHMARK RUNNER
// ===================================================================

/**
 * Runs the full Model Gap Benchmark.
 *
 * @param {Object} options
 * @param {string} [options.model] - Model name for the lower-tier model
 * @param {string} [options.matrixEndpoint] - Matrix endpoint URL (for real mode, future)
 * @param {string} [options.matrixApiKey] - Matrix API key (for real mode, future)
 * @param {string} [options.frontier] - Frontier model name
 * @param {string[]} [options.categories] - Categories to include (default: all)
 * @param {number} [options.taskCount] - Number of tasks per category (default: 5)
 * @param {boolean} [options.verbose] - Verbose output
 * @returns {Object} Complete benchmark report
 */
async function runBenchmark(options = {}) {
  console.warn('[BENCHMARK] ⚠️  SYNTHETIC BENCHMARK — NOT REAL DATA. Zero model calls. Results are illustrative only.');
  const opts = {
    model: options.model || DEFAULT_MODEL,
    frontend: options.frontier || DEFAULT_FRONTIER,
    categories: options.categories || CATEGORIES,
    verbose: options.verbose || false
  };

  // Filter tasks by selected categories
  let tasks = TASKS;
  if (opts.categories.length > 0 && opts.categories[0] !== 'all') {
    tasks = TASKS.filter(t => opts.categories.includes(t.category));
  }

  // Limit tasks per category if specified
  if (options.taskCount && options.taskCount < 5) {
    const perCategory = {};
    const limitedTasks = [];
    for (const t of tasks) {
      if (!perCategory[t.category]) perCategory[t.category] = 0;
      if (perCategory[t.category] < options.taskCount) {
        limitedTasks.push(t);
        perCategory[t.category]++;
      }
    }
    tasks = limitedTasks;
  }

  console.log(`\n${B}${C}╔══════════════════════════════════════════════════════════╗${N}`);
  console.log(`${B}${C}║      Model Gap Benchmark — Matrix Amplification Engine      ║${N}`);
  console.log(`${B}${C}╚══════════════════════════════════════════════════════════╝${N}\n`);

  console.log(` ${B}Model:${N}        ${opts.model}`);
  console.log(` ${B}Frontier:${N}     ${opts.frontend}`);
  console.log(` ${B}Categories:${N}   ${opts.categories.join(', ')}`);
  console.log(` ${B}Total Tasks:${N}  ${tasks.length}`);
  console.log('');

  const startTime = Date.now();

  const allResults = {
    model: [],
    modelMatrix: [],
    frontier: [],
    frontierMatrix: []
  };

  // Run each scenario
  const scenarioIds = Object.keys(SCENARIOS);

  for (const sid of scenarioIds) {
    const scenarioMeta = SCENARIOS[sid];
    const scenarioConfig = QUALITY_CONFIG[sid];

    console.log(`${B}${Y}▶ Scenario: ${scenarioMeta.name}${N}`);
    console.log(` ${D}${scenarioMeta.description}${N}`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskId = task.id;

      if (opts.verbose) {
        process.stdout.write(`   [${String(i + 1).padStart(2)}/${tasks.length}] ${taskId} — ${task.description.substring(0, 55).padEnd(55)} `);
      }

      const result = evaluateTask(task, scenarioConfig, scenarioMeta);

      if (opts.verbose) {
        if (result.success) {
          process.stdout.write(`${G}✓${N} q=${result.qualityScore.toFixed(1)}`);
        } else {
          process.stdout.write(`${R}✗${N} q=${result.qualityScore.toFixed(1)}`);
        }
        if (result.scopeCreep) process.stdout.write(` ${Y}⚠${N}`);
        process.stdout.write('\n');
      } else {
        // Compact progress: dot-colored per result
        if (result.success) {
          process.stdout.write(`${G}.${N}`);
        } else {
          process.stdout.write(`${R}.${N}`);
        }
        // New line every 20 tasks
        if ((i + 1) % 20 === 0 || i === tasks.length - 1) {
          process.stdout.write(` ${D}${i + 1}/${tasks.length}${N}\n`);
        }
      }

      allResults[sid].push(result);
    }

    const summary = computeSummary(allResults[sid]);
    console.log(` ${D}→ Success: ${(summary.successRate * 100).toFixed(0)}% | Avg Quality: ${summary.avgQuality}/10 | Scope Creep: ${(summary.scopeCreepRate * 100).toFixed(0)}%${N}\n`);
  }

  const totalDuration = Date.now() - startTime;

  // Compute summaries
  const summaries = {};
  for (const sid of scenarioIds) {
    summaries[sid] = computeSummary(allResults[sid]);
  }

  // Calculate amplification metrics
  const ampMetrics = calculateMetrics(summaries);

  // Build task comparison
  const taskComparison = buildTaskComparison(allResults);

  // Build full report
  const report = {
    benchmarkVersion: '1.0.0',
    name: 'Model Gap Benchmark',
    description: 'Measures Matrix amplification effect across four scenarios',
    config: {
      model: opts.model,
      frontier: opts.frontend,
      categories: opts.categories,
      totalTasks: tasks.length,
      timestamp: new Date().toISOString(),
      totalDurationMs: totalDuration
    },
    scenarios: {},
    summaries,
    amplificationMetrics: ampMetrics,
    taskComparison,
    results: allResults
  };

  // Fill scenario details
  for (const sid of scenarioIds) {
    report.scenarios[sid] = {
      name: SCENARIOS[sid].name,
      description: SCENARIOS[sid].description,
      summary: summaries[sid],
      resultCount: allResults[sid].length
    };
  }

  return report;
}

// ===================================================================
//  OUTPUT FORMATS
// ===================================================================

/**
 * Prints a formatted table of the benchmark summary.
 * @param {Object} report - Benchmark report
 */
function printTable(report) {
  const s = report.summaries;
  const amp = report.amplificationMetrics;

  console.log(`\n${B}${M}╔══════════════════════════════════════════════════════════════════════╗${N}`);
  console.log(`${B}${M}║              MODEL GAP BENCHMARK — Summary Table                      ║${N}`);
  console.log(`${B}${M}╚══════════════════════════════════════════════════════════════════════╝${N}\n`);

  console.log(` ${B}Config:${N}  Model=${report.config.model} | Frontier=${report.config.frontier}`);
  console.log(`          Tasks=${report.config.totalTasks} | Duration=${formatDuration(report.config.totalDurationMs)}\n`);

  // Main comparison table
  const headerLabel = 'Metric'.padEnd(28);
  const headerModel = 'MODEL'.padEnd(14);
  const headerModelMatrix = 'MODEL+MATRIX'.padEnd(14);
  const headerFrontier = 'FRONTIER'.padEnd(14);
  const headerFrontierMatrix = 'FRONTIER+MATRIX'.padEnd(14);
  console.log(` ${B}${headerLabel} ${headerModel} ${headerModelMatrix} ${headerFrontier} ${headerFrontierMatrix}${N}`);
  console.log(` ${D}${'─'.repeat(84)}${N}`);

  const rows = [
    ['Success Rate',       'successRate',      v => (v * 100).toFixed(1) + '%'],
    ['Avg Quality Score',  'avgQuality',       v => v.toFixed(2) + '/10'],
    ['Median Quality',     'medianQuality',    v => v.toFixed(2) + '/10'],
    ['StdDev Quality',     'stddevQuality',    v => v.toFixed(2)],
    ['Min / Max Quality',  null,               null, true],  // special row
    ['Avg Latency',        'avgLatency',       v => formatDuration(v)],
    ['Avg Model Calls',    'avgModelCalls',    v => v.toFixed(1)],
    ['Avg Tokens',         'avgTokens',        v => v.toFixed(0)],
    ['Total Cost',         'totalCost',        v => '$' + v.toFixed(4)],
    ['Scope Creep Rate',   'scopeCreepRate',   v => (v * 100).toFixed(1) + '%'],
    ['Test Pass Rate',     'testPassRate',     v => (v * 100).toFixed(1) + '%'],
  ];

  for (const [label, field, fmt, isSpecial] of rows) {
    const paddedLabel = label.padEnd(28);
    let vals;
    if (isSpecial && label === 'Min / Max Quality') {
      vals = [
        s.model.minQuality.toFixed(1) + '/' + s.model.maxQuality.toFixed(1),
        s.modelMatrix.minQuality.toFixed(1) + '/' + s.modelMatrix.maxQuality.toFixed(1),
        s.frontier.minQuality.toFixed(1) + '/' + s.frontier.maxQuality.toFixed(1),
        s.frontierMatrix.minQuality.toFixed(1) + '/' + s.frontierMatrix.maxQuality.toFixed(1)
      ];
    } else if (fmt) {
      vals = ['model', 'modelMatrix', 'frontier', 'frontierMatrix'].map(k => fmt(s[k][field]));
    } else {
      vals = ['—', '—', '—', '—'];
    }
    const paddedVals = vals.map(v => String(v).padEnd(14));
    console.log(` ${paddedLabel} ${paddedVals.join(' ')}`);
  }

  console.log('');

  // Amplification Metrics section
  console.log(` ${B}╔═══ AMPLIFICATION METRICS ═══╗${N}\n`);

  console.log(` ${B}Model Gap (Frontier − Model):${N}           ${amp.modelGap.toFixed(2)} points`);
  console.log(` ${B}Residual Gap (Frontier − Model+Matrix):${N}   ${amp.residualGap.toFixed(2)} points`);
  console.log(` ${B}Gap Reduction:${N}                               ${amp.gapReductionPercent}%`);
  console.log(` ${B}Amplification Score (Matrix Boost):${N}          +${amp.amplificationScore.toFixed(2)} points (${amp.amplificationPercent > 0 ? '+' : ''}${amp.amplificationPercent}%)`);
  console.log(` ${B}Frontier Amplification Score:${N}                +${amp.frontierAmplificationScore.toFixed(2)} points`);
  console.log(` ${B}Success Rate Gain (Matrix):${N}                  +${(amp.successRateGain * 100).toFixed(1)}%`);
  console.log(` ${B}Scope Creep Reduction:${N}                       ${amp.scopeCreepReduction > 0 ? '-' : ''}${Math.abs(amp.scopeCreepReduction)}%`);
  console.log(` ${B}Avg Latency Overhead:${N}                        +${formatDuration(amp.averageOverheadMs)} (${amp.overheadPercent > 0 ? '+' : ''}${amp.overheadPercent}%)`);
  console.log(` ${B}Cost per Quality Point (Model+Matrix):${N}       $${amp.costPerQualityPoint.toFixed(6)}`);

  console.log(`\n ${B}Interpretation:${N}`);
  console.log(` ${D}${amp.interpretation.replace(/\n/g, '\n ')}${N}`);

  // Quality by Category
  console.log(`\n ${B}╔═══ QUALITY BY CATEGORY ═══╗${N}\n`);
  const catHeader = 'Category'.padEnd(16) + 'MODEL'.padEnd(12) + 'MODEL+MX'.padEnd(12) + 'FRONTIER'.padEnd(12) + 'FRONT+MX'.padEnd(12);
  console.log(` ${B}${catHeader}${N}`);
  console.log(` ${D}${'─'.repeat(64)}${N}`);
  for (const cat of CATEGORIES) {
    const vals = ['model', 'modelMatrix', 'frontier', 'frontierMatrix'].map(k =>
      (s[k].qualityByCategory[cat] || 0).toFixed(2).padEnd(12)
    );
    console.log(` ${cat.padEnd(16)} ${vals.join(' ')}`);
  }
  console.log('');

  // Top 5 biggest amplification deltas
  console.log(` ${B}╔═══ TOP 5 AMPLIFICATION TASKS ═══╗${N}\n`);
  const sortedByDelta = report.taskComparison
    .filter(t => t.delta_amplification != null)
    .sort((a, b) => Math.abs(b.delta_amplification) - Math.abs(a.delta_amplification))
    .slice(0, 8);
  const taskHeader2 = 'Task'.padEnd(14) + 'Category'.padEnd(14) + 'Model'.padEnd(8) + 'Model+MX'.padEnd(10) + 'Delta'.padEnd(8);
  console.log(` ${B}${taskHeader2}${N}`);
  console.log(` ${D}${'─'.repeat(54)}${N}`);
  for (const t of sortedByDelta) {
    const deltaStr = (t.delta_amplification > 0 ? '+' : '') + t.delta_amplification.toFixed(2);
    console.log(` ${t.taskId.padEnd(14)} ${(t.category || '').padEnd(14)} ${t.quality_model.toFixed(1).padEnd(8)} ${t.quality_modelMatrix.toFixed(1).padEnd(10)} ${deltaStr.padEnd(8)}`);
  }
  console.log('');
}

/**
 * Generates a Markdown report string.
 * @param {Object} report - Benchmark report
 * @returns {string} Markdown formatted report
 */
function generateMarkdownReport(report) {
  const s = report.summaries;
  const amp = report.amplificationMetrics;

  let md = '';
  md += '# Model Gap Benchmark Report\n\n';
  md += `> **Generated:** ${report.config.timestamp}\n`;
  md += `> **Total Tasks:** ${report.config.totalTasks}\n`;
  md += `> **Duration:** ${formatDuration(report.config.totalDurationMs)}\n\n`;

  md += '## Configuration\n\n';
  md += `| Parameter | Value |\n|---|---|\n`;
  md += `| Model | ${report.config.model} |\n`;
  md += `| Frontier | ${report.config.frontier} |\n`;
  md += `| Categories | ${report.config.categories.join(', ')} |\n`;
  md += `| Tasks per Category | 5 |\n\n`;

  md += '## Scenario Comparison\n\n';
  md += '| Metric | MODEL | MODEL+MATRIX | FRONTIER | FRONTIER+MATRIX |\n';
  md += '|---|---|---|---|---|\n';
  md += `| **Success Rate** | ${(s.model.successRate * 100).toFixed(1)}% | ${(s.modelMatrix.successRate * 100).toFixed(1)}% | ${(s.frontier.successRate * 100).toFixed(1)}% | ${(s.frontierMatrix.successRate * 100).toFixed(1)}% |\n`;
  md += `| **Avg Quality** | ${s.model.avgQuality}/10 | ${s.modelMatrix.avgQuality}/10 | ${s.frontier.avgQuality}/10 | ${s.frontierMatrix.avgQuality}/10 |\n`;
  md += `| **Median Quality** | ${s.model.medianQuality}/10 | ${s.modelMatrix.medianQuality}/10 | ${s.frontier.medianQuality}/10 | ${s.frontierMatrix.medianQuality}/10 |\n`;
  md += `| **StdDev Quality** | ${s.model.stddevQuality} | ${s.modelMatrix.stddevQuality} | ${s.frontier.stddevQuality} | ${s.frontierMatrix.stddevQuality} |\n`;
  md += `| **Avg Latency** | ${formatDuration(s.model.avgLatency)} | ${formatDuration(s.modelMatrix.avgLatency)} | ${formatDuration(s.frontier.avgLatency)} | ${formatDuration(s.frontierMatrix.avgLatency)} |\n`;
  md += `| **Avg Model Calls** | ${s.model.avgModelCalls} | ${s.modelMatrix.avgModelCalls} | ${s.frontier.avgModelCalls} | ${s.frontierMatrix.avgModelCalls} |\n`;
  md += `| **Avg Tokens** | ${s.model.avgTokens} | ${s.modelMatrix.avgTokens} | ${s.frontier.avgTokens} | ${s.frontierMatrix.avgTokens} |\n`;
  md += `| **Total Cost** | $${s.model.totalCost.toFixed(4)} | $${s.modelMatrix.totalCost.toFixed(4)} | $${s.frontier.totalCost.toFixed(4)} | $${s.frontierMatrix.totalCost.toFixed(4)} |\n`;
  md += `| **Scope Creep** | ${(s.model.scopeCreepRate * 100).toFixed(1)}% | ${(s.modelMatrix.scopeCreepRate * 100).toFixed(1)}% | ${(s.frontier.scopeCreepRate * 100).toFixed(1)}% | ${(s.frontierMatrix.scopeCreepRate * 100).toFixed(1)}% |\n`;
  md += `| **Test Pass Rate** | ${(s.model.testPassRate * 100).toFixed(1)}% | ${(s.modelMatrix.testPassRate * 100).toFixed(1)}% | ${(s.frontier.testPassRate * 100).toFixed(1)}% | ${(s.frontierMatrix.testPassRate * 100).toFixed(1)}% |\n\n`;

  md += '## Amplification Metrics\n\n';
  md += '| Metric | Value |\n|---|---|\n';
  md += `| Model Gap (Frontier − Model) | ${amp.modelGap.toFixed(2)} |\n`;
  md += `| Residual Gap (Frontier − Model+Matrix) | ${amp.residualGap.toFixed(2)} |\n`;
  md += `| **Gap Reduction** | **${amp.gapReductionPercent}%** |\n`;
  md += `| Amplification Score | +${amp.amplificationScore.toFixed(2)} (${amp.amplificationPercent > 0 ? '+' : ''}${amp.amplificationPercent}%) |\n`;
  md += `| Frontier Amplification | +${amp.frontierAmplificationScore.toFixed(2)} |\n`;
  md += `| Success Rate Gain | +${(amp.successRateGain * 100).toFixed(1)}% |\n`;
  md += `| Scope Creep Reduction | ${amp.scopeCreepReduction > 0 ? '-' : ''}${Math.abs(amp.scopeCreepReduction)}% |\n`;
  md += `| Latency Overhead | +${formatDuration(amp.averageOverheadMs)} (${amp.overheadPercent > 0 ? '+' : ''}${amp.overheadPercent}%) |\n`;
  md += `| Cost per Quality Point | $${amp.costPerQualityPoint.toFixed(6)} |\n\n`;

  md += '### Interpretation\n\n';
  md += amp.interpretation + '\n\n';

  md += '## Quality by Category\n\n';
  md += '| Category | MODEL | MODEL+MATRIX | FRONTIER | FRONTIER+MATRIX |\n';
  md += '|---|---|---|---|---|\n';
  for (const cat of CATEGORIES) {
    const vals = ['model', 'modelMatrix', 'frontier', 'frontierMatrix'].map(k =>
      (s[k].qualityByCategory[cat] || 0).toFixed(2)
    );
    md += `| ${cat} | ${vals[0]} | ${vals[1]} | ${vals[2]} | ${vals[3]} |\n`;
  }
  md += '\n';

  return md;
}

// ===================================================================
//  FILE OUTPUT
// ===================================================================

/**
 * Ensures the output directory exists.
 */
function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Saves the JSON report to file.
 * @param {Object} report - Benchmark report
 * @returns {string} Output file path
 */
function saveJsonReport(report) {
  ensureOutputDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `model-gap-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}

/**
 * Saves the Markdown report to file.
 * @param {string} md - Markdown content
 * @returns {string} Output file path
 */
function saveMarkdownReport(md) {
  ensureOutputDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `model-gap-${ts}.md`);
  fs.writeFileSync(outPath, md, 'utf8');
  return outPath;
}

// ===================================================================
//  CLI ENTRY POINT
// ===================================================================

if (require.main === module) {
  (async function () {
    const args = process.argv.slice(2);

    // Parse --format
    const formatIdx = args.indexOf('--format');
    const format = (formatIdx !== -1 && formatIdx + 1 < args.length)
      ? args[formatIdx + 1]
      : 'table';

    // Parse --model
    const modelIdx = args.indexOf('--model');
    const model = (modelIdx !== -1 && modelIdx + 1 < args.length)
      ? args[modelIdx + 1]
      : DEFAULT_MODEL;

    // Parse --frontier
    const frontierIdx = args.indexOf('--frontier');
    const frontier = (frontierIdx !== -1 && frontierIdx + 1 < args.length)
      ? args[frontierIdx + 1]
      : DEFAULT_FRONTIER;

    // Parse --categories
    const catIdx = args.indexOf('--categories');
    let categories = CATEGORIES;
    if (catIdx !== -1 && catIdx + 1 < args.length) {
      categories = args[catIdx + 1].split(',').map(c => c.trim());
    }

    // Parse --verbose
    const verbose = args.includes('--verbose') || args.includes('-v');

    // Parse --tasks (task count per category)
    const tasksIdx = args.indexOf('--tasks');
    const taskCount = (tasksIdx !== -1 && tasksIdx + 1 < args.length)
      ? parseInt(args[tasksIdx + 1], 10)
      : 5;

    const report = await runBenchmark({
      model,
      frontier,
      categories,
      verbose,
      taskCount
    });

    // Output based on format
    const outputFormats = format === 'all' ? ['table', 'json', 'report'] : [format];

    for (const fmt of outputFormats) {
      switch (fmt) {
        case 'table':
          printTable(report);
          break;
        case 'json': {
          const jsonPath = saveJsonReport(report);
          console.log(`${G}✓${N} JSON report saved: ${jsonPath}`);
          break;
        }
        case 'report': {
          const md = generateMarkdownReport(report);
          const mdPath = saveMarkdownReport(md);
          console.log(`${G}✓${N} Markdown report saved: ${mdPath}`);
          break;
        }
        default:
          console.log(`${Y}⚠${N} Unknown format "${fmt}". Using table format.`);
          printTable(report);
          break;
      }
    }
  })().catch(err => {
    console.error(`${R}Fatal error: ${err.message}${N}`);
    console.error(err.stack);
    process.exit(1);
  });
}

// ===================================================================
//  EXPORTS
// ===================================================================

module.exports = {
  runBenchmark,
  calculateMetrics,
  computeSummary,
  evaluateTask,
  TASKS,
  CATEGORIES,
  SCENARIOS,
  QUALITY_CONFIG,
  CATEGORY_DIFFICULTY,
  printTable,
  generateMarkdownReport,
  saveJsonReport,
  saveMarkdownReport
};
