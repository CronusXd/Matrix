#!/usr/bin/env node
/**
 * Matrix Pipeline State Machine Validator
 * 
 * Reads pipeline.yaml and pipeline-spec.yaml, then validates that every
 * test step references valid states and transitions.
 * 
 * Pure Node.js — zero npm dependencies.
 * 
 * Usage: node validate-pipeline.js
 * Exit code: 0 if all tests pass, 1 if any fail
 */

const fs = require('fs');
const path = require('path');

const { parseSectionList, parseTestSpec, stripQuotes, getTopLevelSections } = require('./lib/yaml-utils');

const BASE_DIR = path.resolve(__dirname, '..');
const PIPELINE_YAML = path.join(BASE_DIR, 'pipeline.yaml');
const SPEC_YAML = path.join(BASE_DIR, 'pipeline-spec.yaml');

// ─── Color helpers (optional — works in most terminals) ────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';



// ─── Core Validation Logic ─────────────────────────────────────────────

function run() {
  console.log('');
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║   Matrix Pipeline — State Machine Validation Suite      ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // ── Step 1: Read and parse pipeline.yaml ────────────────────────────
  console.log(`${BOLD}📖 Lendo pipeline.yaml...${RESET}`);

  let pipelineContent;
  try {
    pipelineContent = fs.readFileSync(PIPELINE_YAML, 'utf8');
  } catch (err) {
    console.error(`${RED}❌ Erro ao ler pipeline.yaml: ${err.message}${RESET}`);
    process.exit(1);
  }

  const states = parseSectionList(pipelineContent, 'states');
  const transitions = parseSectionList(pipelineContent, 'transitions');

  const stateIds = new Set(states.map(s => s.id));
  const transitionMap = new Map();
  for (const t of transitions) {
    if (t.from && t.to) {
      const key = `${t.from}→${t.to}`;
      transitionMap.set(key, t);
    }
  }

  console.log(`   ✓ ${states.length} estados encontrados`);
  console.log(`   ✓ ${transitions.length} transições definidas`);
  console.log('');

  // Verify states list
  const allStateIds = [...stateIds].sort();
  console.log(`   Estados: [${allStateIds.join(', ')}]`);
  console.log('');

  // ── Step 2: Read and parse pipeline-spec.yaml ───────────────────────
  console.log(`${BOLD}📖 Lendo pipeline-spec.yaml...${RESET}`);

  let specContent;
  try {
    specContent = fs.readFileSync(SPEC_YAML, 'utf8');
  } catch (err) {
    console.error(`${RED}❌ Erro ao ler pipeline-spec.yaml: ${err.message}${RESET}`);
    process.exit(1);
  }

  const tests = parseTestSpec(specContent);
  console.log(`   ✓ ${tests.length} testes encontrados`);
  console.log('');

  if (tests.length === 0) {
    console.error(`${RED}❌ Nenhum teste encontrado em pipeline-spec.yaml${RESET}`);
    process.exit(1);
  }

  // ── Step 3: Validate each test ───────────────────────────────────────
  let totalTests = 0;
  let passedTests = 0;

  for (const test of tests) {
    totalTests++;
    const testName = test.name || `Teste #${totalTests}`;
    const steps = test.steps || [];

    console.log(`${BOLD}📋 Teste #${totalTests}: ${testName}${RESET}`);
    if (test.description) {
      console.log(`   ${test.description}`);
    }

    let validSteps = 0;
    let failedSteps = 0;
    let results = [];

    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
      const step = steps[stepIdx];
      const { from, trigger, expect: expected } = step;
      const stepNum = stepIdx + 1;
      let stepOk = true;
      let errors = [];

      // Check: "from" state exists
      if (!from) {
        errors.push(`from não definido`);
        stepOk = false;
      } else if (!stateIds.has(from)) {
        errors.push(`from="${from}" não encontrado em pipeline.yaml states`);
        stepOk = false;
      }

      // Check: "expect" state exists
      if (!expected) {
        errors.push(`expect não definido`);
        stepOk = false;
      } else if (!stateIds.has(expected)) {
        errors.push(`expect="${expected}" não encontrado em pipeline.yaml states`);
        stepOk = false;
      }

      // Check: transition exists
      if (from && expected && stateIds.has(from) && stateIds.has(expected)) {
        const transitionKey = `${from}→${expected}`;
        if (!transitionMap.has(transitionKey)) {
          errors.push(`Transição ${from} → ${expected} não encontrada em pipeline.yaml transitions`);
          stepOk = false;
        } else {
          // Check trigger (optional — soft warning)
          if (trigger) {
            const trans = transitionMap.get(transitionKey);
            if (trans && trans.trigger && trigger !== trans.trigger) {
              console.log(`${YELLOW}  ⚠️  Step ${stepNum}: trigger "${trigger}" difere do trigger definido "${trans.trigger}"${RESET}`);
            }
          }
        }
      }

      if (stepOk) {
        validSteps++;
        results.push(`${GREEN}  ✅ Step ${stepNum}: ${from} → ${expected} válido${RESET}`);
      } else {
        failedSteps++;
        results.push(`${RED}  ❌ Step ${stepNum}: ${errors.join('; ')}${RESET}`);
      }
    }

    // Output results
    for (const r of results) {
      console.log(r);
    }

    if (failedSteps === 0) {
      passedTests++;
      const totalSteps = steps.length;
      console.log(`   ${GREEN}${BOLD}✅ ${testName}: PASS — ${validSteps}/${totalSteps} steps válidos${RESET}`);
    } else {
      const totalSteps = steps.length;
      console.log(`   ${RED}${BOLD}❌ ${testName}: FAIL — ${validSteps}/${totalSteps} steps válidos, ${failedSteps} falhas${RESET}`);
    }
    console.log('');
  }

  // ── Step 4: Summary ──────────────────────────────────────────────────
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  if (passedTests === totalTests) {
    console.log(`${GREEN}${BOLD}✅ ${passedTests}/${totalTests} testes passaram. State machine válida!${RESET}`);
    console.log(`${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}❌ ${passedTests}/${totalTests} testes passaram. State machine INVÁLIDA!${RESET}`);
    console.log(`${YELLOW}   Corrija os erros acima e execute novamente.${RESET}`);
    console.log(`${RESET}`);
    process.exit(1);
  }
}

run();
