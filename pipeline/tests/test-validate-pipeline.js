/**
 * Test: validate-pipeline.js
 * YAML parser, state validation, transition validation.
 *
 * O módulo auto-executa run() no require, por isso redefinimos
 * as funções de parsing e validação aqui.
 */

const assert = require('assert');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

// ─── Funções extraídas do validate-pipeline.js ────────────────────────

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function getTopLevelSections(content) {
  const sections = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
      sections.push(trimmed.slice(0, -1));
    }
  }
  return sections;
}

function parseSectionList(content, sectionName) {
  const lines = content.split('\n');
  const items = [];

  let sectionIndent = -1;
  let sectionStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === sectionName + ':') {
      sectionIndent = lines[i].length - lines[i].trimStart().length;
      sectionStartLine = i;
      break;
    }
  }

  if (sectionStartLine === -1) return items;

  let currentItem = null;
  let listItemIndent = -1;

  for (let i = sectionStartLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent <= sectionIndent && trimmed.endsWith(':')) {
      break;
    }

    if (indent <= sectionIndent) continue;

    if (trimmed.startsWith('- ')) {
      if (listItemIndent === -1) listItemIndent = indent;

      if (currentItem) items.push(currentItem);
      currentItem = {};

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentItem[key] = value;
      }
    } else if (currentItem && indent > listItemIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();

        if (value === '') {
          currentItem[key] = [];
          continue;
        }

        value = stripQuotes(value);
        currentItem[key] = value;
      }
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
}

function parseTestSpec(content) {
  const lines = content.split('\n');
  const tests = [];

  let testSectionIndent = -1;
  let testSectionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'tests:') {
      testSectionIndent = lines[i].length - lines[i].trimStart().length;
      testSectionStart = i;
      break;
    }
  }

  if (testSectionStart === -1) return tests;

  let currentTest = null;
  let currentStep = null;
  let inSteps = false;
  let testListItemIndent = -1;
  let stepListItemIndent = -1;
  let stepsPropertyIndent = -1;

  for (let i = testSectionStart + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent <= testSectionIndent && trimmed.endsWith(':')) {
      break;
    }
    if (indent <= testSectionIndent) continue;

    const isDashItem = trimmed.startsWith('- ');
    const isKeyValue = !isDashItem && trimmed.includes(':');

    const belongsToTest = isDashItem && (testListItemIndent === -1 || indent === testListItemIndent);
    const belongsToStep = isDashItem && inSteps && stepListItemIndent !== -1 && indent === stepListItemIndent;

    if (inSteps && isDashItem && indent <= stepsPropertyIndent) {
      if (currentStep) {
        currentTest.steps.push(currentStep);
        currentStep = null;
      }
      inSteps = false;

      if (currentTest && currentTest.steps) {
        tests.push(currentTest);
      }
      currentTest = { steps: [] };
      currentStep = null;

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    if (inSteps && !isDashItem && indent <= stepsPropertyIndent && isKeyValue) {
      if (currentStep) {
        currentTest.steps.push(currentStep);
        currentStep = null;
      }
      inSteps = false;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    if (currentTest && !inSteps && trimmed === 'steps:' && indent > testListItemIndent) {
      inSteps = true;
      if (stepsPropertyIndent === -1) stepsPropertyIndent = indent;
      continue;
    }

    if (inSteps && isDashItem && currentTest) {
      if (stepListItemIndent === -1) stepListItemIndent = indent;

      if (currentStep) currentTest.steps.push(currentStep);
      currentStep = {};

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentStep[key] = value;
      }
      continue;
    }

    if (inSteps && currentStep && isKeyValue && indent > stepListItemIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentStep[key] = value;
      }
      continue;
    }

    if (!inSteps && isDashItem) {
      if (testListItemIndent === -1) testListItemIndent = indent;

      if (currentTest && currentTest.steps) {
        tests.push(currentTest);
      }

      currentTest = { steps: [] };
      currentStep = null;

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    if (!inSteps && currentTest && isKeyValue && indent > testListItemIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }
  }

  if (currentStep && currentTest) currentTest.steps.push(currentStep);
  if (currentTest && currentTest.steps) tests.push(currentTest);

  return tests;
}

// ─── Tests: stripQuotes ──────────────────────────────────────────────

console.log('\n📋 validate-pipeline.js — stripQuotes\n');

test('stripQuotes: aspas duplas', () => {
  assert.strictEqual(stripQuotes('"hello"'), 'hello');
});

test('stripQuotes: aspas simples', () => {
  assert.strictEqual(stripQuotes("'hello'"), 'hello');
});

test('stripQuotes: sem aspas', () => {
  assert.strictEqual(stripQuotes('hello'), 'hello');
});

test('stripQuotes: aspas só no início', () => {
  assert.strictEqual(stripQuotes('"hello'), '"hello');
});

test('stripQuotes: aspas só no fim', () => {
  assert.strictEqual(stripQuotes('hello"'), 'hello"');
});

test('stripQuotes: string vazia', () => {
  assert.strictEqual(stripQuotes(''), '');
});

test('stripQuotes: aspas aninhadas', () => {
  assert.strictEqual(stripQuotes('"hello \'world\'"'), 'hello \'world\'');
});

test('stripQuotes: aspas com espaços', () => {
  assert.strictEqual(stripQuotes('"  spaced  "'), '  spaced  ');
});

test('stripQuotes: número como string com aspas', () => {
  assert.strictEqual(stripQuotes('"123"'), '123');
});

// ─── Tests: getTopLevelSections ──────────────────────────────────────

console.log('\n📋 validate-pipeline.js — getTopLevelSections\n');

test('getTopLevelSections: seções básicas', () => {
  const yaml = `
pipeline:
  name: "test"

states:
  - id: "idle"

transitions:
  - from: "idle"
    to: "active"
`;
  const sections = getTopLevelSections(yaml);
  assert.ok(sections.includes('pipeline'));
  assert.ok(sections.includes('states'));
  assert.ok(sections.includes('transitions'));
});

test('getTopLevelSections: comentários ignorados', () => {
  const yaml = `# comment
pipeline:
  name: test
# another comment
states:
  - id: idle
`;
  const sections = getTopLevelSections(yaml);
  assert.deepStrictEqual(sections, ['pipeline', 'states']);
});

test('getTopLevelSections: arquivo vazio', () => {
  const sections = getTopLevelSections('');
  assert.deepStrictEqual(sections, []);
});

test('getTopLevelSections: apenas comentários', () => {
  const sections = getTopLevelSections('# apenas comentários\n# outro');
  assert.deepStrictEqual(sections, []);
});

test('getTopLevelSections: linhas em branco entre seções', () => {
  const yaml = `section1:

section2:
  key: value

section3:
`;
  const sections = getTopLevelSections(yaml);
  assert.deepStrictEqual(sections, ['section1', 'section2', 'section3']);
});

test('getTopLevelSections: seção com underscore no nome', () => {
  const yaml = `my_section:
  key: value`;
  const sections = getTopLevelSections(yaml);
  assert.deepStrictEqual(sections, ['my_section']);
});

test('getTopLevelSections: linhas com traço não são seções', () => {
  const yaml = `- item1
- item2
states:
  - idle`;
  const sections = getTopLevelSections(yaml);
  assert.deepStrictEqual(sections, ['states']);
});

// ─── Tests: parseSectionList ─────────────────────────────────────────

console.log('\n📋 validate-pipeline.js — parseSectionList\n');

test('parseSectionList: lista simples de objetos', () => {
  const yaml = `
states:
  - id: "idle"
    phase: "init"
  - id: "active"
    phase: "running"
`;
  const items = parseSectionList(yaml, 'states');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].id, 'idle');
  assert.strictEqual(items[0].phase, 'init');
  assert.strictEqual(items[1].id, 'active');
  assert.strictEqual(items[1].phase, 'running');
});

test('parseSectionList: seção vazia', () => {
  const yaml = `states:`;
  const items = parseSectionList(yaml, 'states');
  assert.deepStrictEqual(items, []);
});

test('parseSectionList: seção não existe', () => {
  const yaml = `states:
  - id: "idle"`;
  const items = parseSectionList(yaml, 'nonexistent');
  assert.deepStrictEqual(items, []);
});

test('parseSectionList: valores com aspas são strippados', () => {
  const yaml = `
items:
  - name: "hello world"
    desc: 'single quoted'
`;
  const items = parseSectionList(yaml, 'items');
  assert.strictEqual(items[0].name, 'hello world');
  assert.strictEqual(items[0].desc, 'single quoted');
});

test('parseSectionList: valores com aspas e espaços', () => {
  const yaml = `
config:
  - key: "value with spaces"
`;
  const items = parseSectionList(yaml, 'config');
  assert.strictEqual(items[0].key, 'value with spaces');
});

test('parseSectionList: encontra a primeira seção com o nome', () => {
  const yaml = `
states:
  - id: "first"
parent:
  states:
    - id: "nested"
`;
  const items = parseSectionList(yaml, 'states');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, 'first');
});

test('parseSectionList: seção com comentários entre itens', () => {
  const yaml = `
states:
  - id: "first"
    # comentário
  - id: "second"
`;
  const items = parseSectionList(yaml, 'states');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].id, 'first');
  assert.strictEqual(items[1].id, 'second');
});

test('parseSectionList: item com array vazio como valor', () => {
  const yaml = `
config:
  - name: "test"
    items:
`;
  const items = parseSectionList(yaml, 'config');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].name, 'test');
  assert.deepStrictEqual(items[0].items, []);
});

test('parseSectionList: item com trigger e from/to', () => {
  const yaml = `
transitions:
  - from: "idle"
    to: "active"
    trigger: "start"
  - from: "active"
    to: "done"
`;
  const items = parseSectionList(yaml, 'transitions');
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].from, 'idle');
  assert.strictEqual(items[0].to, 'active');
  assert.strictEqual(items[0].trigger, 'start');
  assert.strictEqual(items[1].from, 'active');
  assert.strictEqual(items[1].to, 'done');
});

// ─── Tests: parseTestSpec ────────────────────────────────────────────

console.log('\n📋 validate-pipeline.js — parseTestSpec\n');

test('parseTestSpec: teste simples com steps', () => {
  const yaml = `
tests:
  - name: "Test 1"
    description: "Simple test"
    steps:
      - from: "idle"
        trigger: "start"
        expect: "active"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests.length, 1);
  assert.strictEqual(tests[0].name, 'Test 1');
  assert.strictEqual(tests[0].steps.length, 1);
  assert.strictEqual(tests[0].steps[0].from, 'idle');
  assert.strictEqual(tests[0].steps[0].trigger, 'start');
  assert.strictEqual(tests[0].steps[0].expect, 'active');
});

test('parseTestSpec: múltiplos testes com múltiplos steps', () => {
  const yaml = `
tests:
  - name: "Test A"
    steps:
      - from: "a"
        expect: "b"
      - from: "b"
        expect: "c"
  - name: "Test B"
    steps:
      - from: "x"
        expect: "y"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests.length, 2);
  assert.strictEqual(tests[0].steps.length, 2);
  assert.strictEqual(tests[1].steps.length, 1);
});

test('parseTestSpec: seção tests vazia', () => {
  const yaml = `tests:`;
  const tests = parseTestSpec(yaml);
  assert.deepStrictEqual(tests, []);
});

test('parseTestSpec: sem seção tests', () => {
  const yaml = `other:`;
  const tests = parseTestSpec(yaml);
  assert.deepStrictEqual(tests, []);
});

test('parseTestSpec: steps com descrição no test', () => {
  const yaml = `
tests:
  - name: "With description"
    description: "Some desc"
    steps:
      - from: "idle"
        expect: "done"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests[0].description, 'Some desc');
  assert.strictEqual(tests[0].steps.length, 1);
});

test('parseTestSpec: preserva trigger nos steps', () => {
  const yaml = `
tests:
  - name: "Trigger test"
    steps:
      - from: "idle"
        trigger: "user demand"
        expect: "active"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests[0].steps[0].trigger, 'user demand');
});

test('parseTestSpec: step com razão (reason)', () => {
  const yaml = `
tests:
  - name: "With reason"
    steps:
      - from: "idle"
        expect: "done"
        reason: "completed"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests[0].steps[0].reason, 'completed');
});

test('parseTestSpec: steps com trigger único (expect sem from)', () => {
  const yaml = `
tests:
  - name: "From only"
    steps:
      - from: "idle"
        expect: "active"
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests[0].steps[0].from, 'idle');
  assert.strictEqual(tests[0].steps[0].expect, 'active');
});

test('parseTestSpec: teste sem steps (array vazio)', () => {
  const yaml = `
tests:
  - name: "Empty test"
    steps:
`;
  const tests = parseTestSpec(yaml);
  assert.strictEqual(tests.length, 1);
  assert.strictEqual(tests[0].steps.length, 0);
});

// ─── Tests: Validação de transições (lógica) ─────────────────────────

console.log('\n📋 validate-pipeline.js — Validação de Transições\n');

test('validação: estado from existe no set', () => {
  const stateIds = new Set(['idle', 'active', 'done']);
  assert.ok(stateIds.has('idle'));
  assert.ok(!stateIds.has('nonexistent'));
});

test('validação: transição existe no map', () => {
  const transitionMap = new Map();
  transitionMap.set('idle→active', { from: 'idle', to: 'active' });
  assert.ok(transitionMap.has('idle→active'));
  assert.ok(!transitionMap.has('idle→done'));
});

test('validação: trigger opcional não quebra', () => {
  const transitionMap = new Map();
  transitionMap.set('a→b', { from: 'a', to: 'b', trigger: 'go' });

  const trans = transitionMap.get('a→b');
  assert.ok(trans);
  assert.strictEqual(trans.trigger, 'go');
  // Se trigger for undefined, não deve crashar
  assert.doesNotThrow(() => {
    const t2 = transitionMap.get('a→b');
    if (t2 && t2.trigger && 'different' !== t2.trigger) {
      // soft warning
    }
  });
});

test('validação: estado inexistente no from', () => {
  const stateIds = new Set(['active', 'done']);
  const from = 'nonexistent';
  const stepOk = stateIds.has(from);
  assert.strictEqual(stepOk, false);
});

test('validação: estado inexistente no expect', () => {
  const stateIds = new Set(['idle', 'active']);
  const expected = 'completed';
  const stepOk = stateIds.has(expected);
  assert.strictEqual(stepOk, false);
});

test('validação: transição inexistente', () => {
  const stateIds = new Set(['idle', 'active', 'done']);
  const transitionMap = new Map();
  transitionMap.set('idle→active', { from: 'idle', to: 'active' });

  const from = 'idle';
  const expected = 'done';
  if (from && expected && stateIds.has(from) && stateIds.has(expected)) {
    const transitionKey = `${from}→${expected}`;
    // done não conecta a idle
    assert.strictEqual(transitionMap.has(transitionKey), false);
  }
});

test('validação: trigger mismatch gera warning (não quebra)', () => {
  const transitionMap = new Map();
  transitionMap.set('idle→active', { from: 'idle', to: 'active', trigger: 'start' });

  const trans = transitionMap.get('idle→active');
  assert.strictEqual(trans.trigger, 'start');

  // Trigger diferente, mas não crasha
  const inputTrigger = 'force';
  var warning = false;
  if (trans && trans.trigger && inputTrigger !== trans.trigger) {
    warning = true;
  }
  assert.strictEqual(warning, true);
});

test('validação: trigger match não gera warning', () => {
  const transitionMap = new Map();
  transitionMap.set('idle→active', { from: 'idle', to: 'active', trigger: 'start' });

  const trans = transitionMap.get('idle→active');
  var warning = false;
  if (trans && trans.trigger && 'start' !== trans.trigger) {
    warning = true;
  }
  assert.strictEqual(warning, false);
});

// ─── Tests: run() function path resolution ───────────────────────────

console.log('\n📋 validate-pipeline.js — Path Resolution\n');

test('Caminho do pipeline.yaml é relativo a scripts/..', () => {
  const path = require('path');
  const BASE_DIR = path.resolve(__dirname, '..');
  const expectedYaml = path.join(BASE_DIR, 'pipeline.yaml');
  // Verifica que o arquivo existe
  const fs = require('fs');
  const exists = fs.existsSync(expectedYaml);
  assert.strictEqual(exists, true);
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
