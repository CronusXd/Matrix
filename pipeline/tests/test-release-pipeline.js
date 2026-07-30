#!/usr/bin/env node
/**
 * Test: release-pipeline.yaml — State Machine Validation
 *
 * Valida a estrutura da state machine do release pipeline:
 *   - 9 estados
 *   - 12+ transições
 *   - 4 fases agrupadas
 *   - start_state e end_states definidos
 *   - Hooks pre_release e post_release
 *   - Sintaxe YAML válida
 *   - Transições válidas (todos os 'from' e 'to' referenciam estados existentes)
 *
 * Zero npm dependencies. assert nativo.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  \x1b[32m✅ ' + name + '\x1b[0m');
    testsPassed++;
  } catch (err) {
    console.log('  \x1b[31m❌ ' + name + ': ' + err.message + '\x1b[0m');
    testsFailed++;
  }
}

// ─── Parse YAML simples (inline, sem dependências) ───────────────────
function parseYamlSimple(raw) {
  const lines = raw.split('\n');
  const result = {};
  let currentKey = null;
  let currentIndent = 0;
  let inList = false;
  let listKey = null;
  let listItems = [];
  let listItemObj = null;
  let listItemIndent = 0;

  function commitList() {
    if (listKey && listItems.length > 0) {
      result[listKey] = listItems;
      listKey = null;
      listItems = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    if (trimmed.startsWith('- ')) {
      // List item
      if (!listKey) {
        // We need to figure out the parent key
        continue;
      }
      const value = trimmed.substring(2).trim();
      if (value.includes(': ')) {
        // Object inline
        const parts = value.split(': ');
        const obj = {};
        obj[parts[0].trim()] = parseValue(parts.slice(1).join(': '));
        listItems.push(obj);
      } else if (value.startsWith('{') && value.endsWith('}')) {
        // Inline object {key: value}
        const obj = parseInlineObject(value);
        listItems.push(obj);
      } else {
        listItems.push(parseValue(value));
      }
      continue;
    }

    if (trimmed.endsWith(':') || trimmed.includes(': ')) {
      // Key or key-value pair
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim();
      const value = trimmed.substring(colonIdx + 1).trim();

      if (value === '' || value === '>') {
        // Object key (nested structure)
        if (indent === 0) {
          commitList();
          currentKey = key;
          result[currentKey] = {};
          currentIndent = 0;
        } else if (currentKey) {
          result[currentKey][key] = {};
        }
        // Check if this key has a list
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextTrimmed = nextLine.trim();
          const nextIndent = nextLine.length - nextLine.trimStart().length;
          if (nextTrimmed.startsWith('- ') && nextIndent > indent) {
            commitList();
            listKey = key;
            listItems = [];
            // Set listItemObj if parent is an object
            if (currentKey && result[currentKey]) {
              listItemObj = result[currentKey];
            }
          }
        }
      } else {
        // Simple key-value pair
        if (indent === 0) {
          commitList();
          result[key] = parseValue(value);
        } else if (currentKey && result[currentKey]) {
          result[currentKey][key] = parseValue(value);
        }
      }
    }
  }

  commitList();
  return result;
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineObject(str) {
  const inner = str.slice(1, -1).trim();
  const obj = {};
  if (!inner) return obj;
  const parts = inner.split(',');
  parts.forEach(function(part) {
    const colonIdx = part.indexOf(':');
    if (colonIdx >= 0) {
      const key = part.substring(0, colonIdx).trim();
      const val = part.substring(colonIdx + 1).trim();
      obj[key] = parseValue(val);
    }
  });
  return obj;
}

// ─── Load release-pipeline.yaml ───────────────────────────────────────
const RELEASE_PIPELINE_YAML = path.resolve(__dirname, '..', 'release-pipeline.yaml');

function loadReleaseYaml() {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  return { raw: raw, lines: raw.split('\n') };
}

// ═══════════════════════════════════════════════════════════════════════
// Estrutura Geral
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 Structure — Geral\x1b[0m\n');

test('release-pipeline.yaml existe', () => {
  assert.ok(fs.existsSync(RELEASE_PIPELINE_YAML),
    'Arquivo não encontrado: ' + RELEASE_PIPELINE_YAML);
});

test('release-pipeline.yaml contém pipeline name = Matrix Release Pipeline', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('Matrix Release Pipeline'),
    'Deve conter nome do pipeline');
});

test('release-pipeline.yaml contém seções obrigatórias', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('states:'), 'Deve conter seção states');
  assert.ok(raw.includes('transitions:'), 'Deve conter seção transitions');
  assert.ok(raw.includes('phases:'), 'Deve conter seção phases');
  assert.ok(raw.includes('hooks:'), 'Deve conter seção hooks');
});

test('release-pipeline.yaml: start_state = idle', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('start_state: "idle"') || raw.includes("start_state: 'idle'") ||
            raw.includes('start_state: idle'),
    'start_state deve ser idle');
});

test('release-pipeline.yaml: end_states definidos', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('end_states:') && (raw.includes('completed') && raw.includes('failed') && raw.includes('escalated')),
    'end_states deve conter completed, failed, escalated');
});

// ═══════════════════════════════════════════════════════════════════════
// Estados (9)
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 States — 9 estados\x1b[0m\n');

test('release-pipeline.yaml: exatamente 9 estados (idle, version_bump, changelog, tag, build, deploy, completed, failed, escalated)', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  const lines = raw.split('\n');

  let inStates = false;
  const states = [];

  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('states:')) { inStates = true; return; }
    if (inStates && trimmed.startsWith('- id:')) {
      const id = trimmed.replace('- id:', '').trim().replace(/["']/g, '');
      states.push(id);
    }
    // Exit states section on new top-level key
    if (inStates && line.length > 0 && line.trimLeft().length === line.length &&
        trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
      if (trimmed.includes(':')) { inStates = false; }
    }
  });

  assert.strictEqual(states.length, 9,
    'Deve ter 9 estados, encontrado ' + states.length + ': ' + states.join(', '));
});

test('release-pipeline.yaml: estados esperados presentes', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  const expectedStates = ['idle', 'version_bump', 'changelog', 'tag', 'build', 'deploy', 'completed', 'failed', 'escalated'];

  expectedStates.forEach(function(state) {
    // Procura "- id: <state>" no YAML
    const regex = new RegExp('- id:\\s*["\']?' + state + '["\']?');
    assert.ok(regex.test(raw), 'Estado "' + state + '" não encontrado');
  });
});

test('release-pipeline.yaml: cada estado tem id, phase, description', () => {
  const lines = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8').split('\n');
  let inStates = false;
  let stateCount = 0;
  let currentState = {};

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('states:')) { inStates = true; continue; }

    // Exit on new top-level key
    if (inStates && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        lines[i].length === lines[i].trimStart().length) {
      break;
    }

    if (inStates && trimmed.startsWith('- id:')) {
      // Commit previous state
      if (currentState.id) {
        assert.ok(currentState.phase !== undefined, 'Estado "' + currentState.id + '" sem phase');
        assert.ok(currentState.description !== undefined, 'Estado "' + currentState.id + '" sem description');
        stateCount++;
      }
      currentState = {
        id: trimmed.replace('- id:', '').trim().replace(/["']/g, '')
      };
    }
    if (inStates && currentState.id && trimmed.startsWith('phase:')) {
      currentState.phase = trimmed.replace('phase:', '').trim().replace(/["']/g, '');
    }
    if (inStates && currentState.id && trimmed.startsWith('description:')) {
      currentState.description = trimmed.replace('description:', '').trim().replace(/["']/g, '');
    }
  }

  // Last state
  if (currentState.id) {
    assert.ok(currentState.phase !== undefined, 'Estado "' + currentState.id + '" sem phase');
    assert.ok(currentState.description !== undefined, 'Estado "' + currentState.id + '" sem description');
    stateCount++;
  }

  assert.strictEqual(stateCount, 9, 'Deve validar 9 estados, validou ' + stateCount);
});

// ═══════════════════════════════════════════════════════════════════════
// Transições (12+)
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 Transitions — 12+ transições\x1b[0m\n');

test('release-pipeline.yaml: mínimo 12 transições', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  const lines = raw.split('\n');
  let inTransitions = false;
  let transitionCount = 0;

  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('transitions:')) { inTransitions = true; return; }
    if (inTransitions && trimmed.startsWith('- from:')) { transitionCount++; }
    if (inTransitions && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        line.length === line.trimStart().length && trimmed !== '') {
      if (!trimmed.startsWith('hooks:') && !trimmed.startsWith('phases:')) {
        inTransitions = false;
      }
    }
  });

  assert.ok(transitionCount >= 12,
    'Mínimo 12 transições, encontrado ' + transitionCount);
});

test('release-pipeline.yaml: cada transição tem from, to, trigger, action', () => {
  const lines = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8').split('\n');
  let inTransitions = false;
  let currentTransition = null;
  let transitions = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('transitions:')) { inTransitions = true; continue; }

    // Exit transitions section
    if (inTransitions && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        lines[i].length === lines[i].trimStart().length) {
      if (currentTransition) {
        transitions.push(currentTransition);
        currentTransition = null;
      }
      inTransitions = false;
    }

    if (inTransitions && trimmed.startsWith('- from:')) {
      if (currentTransition) transitions.push(currentTransition);
      currentTransition = {
        from: trimmed.replace('- from:', '').trim().replace(/["']/g, '')
      };
    }
    if (inTransitions && currentTransition && trimmed.startsWith('to:')) {
      currentTransition.to = trimmed.replace('to:', '').trim().replace(/["']/g, '');
    }
    if (inTransitions && currentTransition && trimmed.startsWith('trigger:')) {
      currentTransition.trigger = trimmed.replace('trigger:', '').trim().replace(/["']/g, '');
    }
    if (inTransitions && currentTransition && trimmed.startsWith('action:')) {
      currentTransition.action = trimmed.replace('action:', '').trim().replace(/["']/g, '');
    }
  }
  if (currentTransition) transitions.push(currentTransition);

  // Validate each transition
  transitions.forEach(function(t, idx) {
    assert.ok(t.from !== undefined, 'Transição ' + idx + ' sem campo from');
    assert.ok(t.to !== undefined, 'Transição ' + idx + ' sem campo to');
    assert.ok(t.trigger !== undefined, 'Transição ' + idx + ' (' + t.from + '→' + t.to + ') sem trigger');
    assert.ok(t.action !== undefined, 'Transição ' + idx + ' (' + t.from + '→' + t.to + ') sem action');
  });
});

test('release-pipeline.yaml: todas as transições referenciam estados válidos', () => {
  const lines = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8').split('\n');

  // Collect states
  let inStates = false;
  const states = new Set();
  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('states:')) { inStates = true; return; }
    if (inStates && trimmed.startsWith('- id:')) {
      const id = trimmed.replace('- id:', '').trim().replace(/["']/g, '');
      states.add(id);
    }
    if (inStates && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        line.length === line.trimStart().length) {
      inStates = false;
    }
  });

  // Collect transitions
  let inTransitions = false;
  let currentTransition = null;
  let transitions = [];

  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('transitions:')) { inTransitions = true; return; }
    if (inTransitions && trimmed.startsWith('- from:')) {
      if (currentTransition) transitions.push(currentTransition);
      currentTransition = {
        from: trimmed.replace('- from:', '').trim().replace(/["']/g, '')
      };
    }
    if (inTransitions && currentTransition && trimmed.startsWith('to:')) {
      currentTransition.to = trimmed.replace('to:', '').trim().replace(/["']/g, '');
    }
    if (inTransitions && currentTransition && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        line.length === line.trimStart().length) {
      if (currentTransition) { transitions.push(currentTransition); currentTransition = null; }
      inTransitions = false;
    }
  });
  if (currentTransition) transitions.push(currentTransition);

  // Validate each transition references valid states
  transitions.forEach(function(t, idx) {
    assert.ok(states.has(t.from), 'Transição ' + idx + ': from="' + t.from + '" não é um estado válido');
    assert.ok(states.has(t.to), 'Transição ' + idx + ' (' + t.from + '→): to="' + t.to + '" não é um estado válido');
  });
});

test('release-pipeline.yaml: transições de erro existem (failed/escalated)', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  // Deve haver pelo menos 3 transições para failed (version_bump→failed, changelog→failed, tag→failed, build→failed, deploy→failed)
  const failedMatches = raw.match(/to:\s*["']?failed["']?/g);
  assert.ok(failedMatches && failedMatches.length >= 5,
    'Deve ter pelo menos 5 transições para "failed", encontrado ' + (failedMatches ? failedMatches.length : 0));

  // Deve haver transição escalated→idle
  const escalatedMatch = raw.match(/from:\s*["']?escalated["']?/);
  assert.ok(escalatedMatch, 'Deve haver transição de escalated');
});

// ═══════════════════════════════════════════════════════════════════════
// Fases (4)
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 Phases — 4 fases\x1b[0m\n');

test('release-pipeline.yaml: 4 fases (init, prep, build, final)', () => {
  const lines = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8').split('\n');
  let inPhases = false;
  const phases = [];

  lines.forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('phases:')) { inPhases = true; return; }
    if (inPhases && trimmed.startsWith('- name:')) {
      const name = trimmed.replace('- name:', '').trim().replace(/["']/g, '');
      phases.push(name);
    }
    if (inPhases && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        line.length === line.trimStart().length) {
      inPhases = false;
    }
  });

  assert.strictEqual(phases.length, 4,
    'Deve ter 4 fases, encontrado ' + phases.length + ': ' + phases.join(', '));
  const expectedPhases = ['init', 'prep', 'build', 'final'];
  expectedPhases.forEach(function(p) {
    assert.ok(phases.indexOf(p) >= 0, 'Fase "' + p + '" não encontrada');
  });
});

test('release-pipeline.yaml: cada fase tem name, description, states, verification', () => {
  const lines = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8').split('\n');
  let inPhases = false;
  let currentPhase = null;
  let phaseCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('phases:')) { inPhases = true; continue; }
    if (inPhases && trimmed.startsWith('- name:')) {
      if (currentPhase && currentPhase.name) {
        phaseCount++;
        assert.ok(currentPhase.description, 'Fase "' + currentPhase.name + '" sem description');
        assert.ok(currentPhase.states, 'Fase "' + currentPhase.name + '" sem states');
        assert.ok(currentPhase.verification, 'Fase "' + currentPhase.name + '" sem verification');
      }
      currentPhase = {
        name: trimmed.replace('- name:', '').trim().replace(/["']/g, '')
      };
    }
    if (inPhases && currentPhase) {
      if (trimmed.startsWith('description:')) currentPhase.description = trimmed;
      if (trimmed.startsWith('states:')) currentPhase.states = trimmed;
      if (trimmed.startsWith('verification:')) currentPhase.verification = trimmed;
    }
    if (inPhases && currentPhase && !trimmed.startsWith('-') && !trimmed.startsWith('#') && trimmed.includes(':') &&
        lines[i].length === lines[i].trimStart().length && !trimmed.startsWith('states:') &&
        !trimmed.startsWith('description:') && !trimmed.startsWith('verification:') &&
        !trimmed.startsWith('checklist_ref:')) {
      inPhases = false;
    }
  }
  if (currentPhase && currentPhase.name) {
    phaseCount++;
    assert.ok(currentPhase.description, 'Fase "' + currentPhase.name + '" sem description');
    assert.ok(currentPhase.states, 'Fase "' + currentPhase.name + '" sem states');
    assert.ok(currentPhase.verification, 'Fase "' + currentPhase.name + '" sem verification');
  }

  assert.strictEqual(phaseCount, 4, 'Deve validar 4 fases, validou ' + phaseCount);
});

// ═══════════════════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 Hooks — pre_release + post_release\x1b[0m\n');

test('release-pipeline.yaml: hooks contém pre_release', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('pre_release:'), 'Deve conter hook pre_release');
});

test('release-pipeline.yaml: hooks contém post_release', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('post_release:'), 'Deve conter hook post_release');
});

test('release-pipeline.yaml: pre_release tem execution_point e on_failure', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  assert.ok(raw.includes('execution_point:'), 'pre_release deve ter execution_point');
  assert.ok(raw.includes('on_failure:'), 'pre_release deve ter on_failure');
});

// ═══════════════════════════════════════════════════════════════════════
// Consistência cruzada
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 Cross-validation\x1b[0m\n');

test('release-pipeline.yaml: todos os estados das fases existem na lista de estados', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');

  // Extract state IDs
  const stateRegex = /- id:\s*["']?(\w+)["']?/g;
  const states = [];
  let match;
  while ((match = stateRegex.exec(raw)) !== null) {
    states.push(match[1]);
  }

  // Extract phase state references
  const phaseStateRegex = /states:\s*\[([^\]]+)\]/g;
  while ((match = phaseStateRegex.exec(raw)) !== null) {
    const refs = match[1].split(',').map(function(s) { return s.trim().replace(/["']/g, ''); });
    refs.forEach(function(ref) {
      assert.ok(states.indexOf(ref) >= 0,
        'Fase referencia estado "' + ref + '" que não existe na lista de estados');
    });
  }
});

test('release-pipeline.yaml: estados finais (completed, failed, escalated) têm phase=final', () => {
  const raw = fs.readFileSync(RELEASE_PIPELINE_YAML, 'utf8');
  const finalStates = ['completed', 'failed', 'escalated'];
  finalStates.forEach(function(state) {
    // Find this state's phase
    const regex = new RegExp('- id:\\s*["\']?' + state + '["\']?[\\s\\S]*?phase:\\s*["\']?(\\w+)["\']?');
    const match = regex.exec(raw);
    if (match) {
      assert.strictEqual(match[1], 'final',
        'Estado "' + state + '" deve ter phase=final, encontrado phase=' + match[1]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Release Config
// ═══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[36m\x1b[1m📋 release-config.yaml\x1b[0m\n');

const RELEASE_CONFIG_YAML = path.resolve(__dirname, '..', 'release-config.yaml');

test('release-config.yaml existe', () => {
  assert.ok(fs.existsSync(RELEASE_CONFIG_YAML),
    'Arquivo não encontrado: ' + RELEASE_CONFIG_YAML);
});

test('release-config.yaml: contém campos obrigatórios', () => {
  const raw = fs.readFileSync(RELEASE_CONFIG_YAML, 'utf8');
  assert.ok(raw.includes('version_file:'), 'Deve conter version_file');
  assert.ok(raw.includes('changelog_file:'), 'Deve conter changelog_file');
  assert.ok(raw.includes('tag_prefix:'), 'Deve conter tag_prefix');
  assert.ok(raw.includes('auto_increment:'), 'Deve conter auto_increment');
  assert.ok(raw.includes('pre_release_hooks:'), 'Deve conter pre_release_hooks');
  assert.ok(raw.includes('post_release_hooks:'), 'Deve conter post_release_hooks');
  assert.ok(raw.includes('max_retries:'), 'Deve conter max_retries');
});

test('release-config.yaml: auto_increment é patch|minor|major', () => {
  const raw = fs.readFileSync(RELEASE_CONFIG_YAML, 'utf8');
  const validValues = ['patch', 'minor', 'major'];
  const match = raw.match(/auto_increment:\s*["']?(\w+)["']?/);
  assert.ok(match, 'auto_increment não encontrado');
  assert.ok(validValues.indexOf(match[1]) >= 0,
    'auto_increment deve ser patch|minor|major, encontrado "' + match[1] + '"');
});

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════

const total = testsPassed + testsFailed;
console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
  (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                       '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

process.exit(testsFailed > 0 ? 1 : 0);
