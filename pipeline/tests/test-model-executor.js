/**
 * Testes para o Model Executor (Real Fallback Chain)
 */
const { ModelExecutor, ModelExecutionError, DEFAULT_CHAINS } = require('../scripts/model-executor');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✓ ' + label);
    passed++;
  } else {
    console.log('  ✖ ' + label);
    failed++;
  }
}

console.log('=== Model Executor Tests ===\n');

// ─── Test 1: Constructor ───────────────────────────────────────
console.log('[Constructor]');
const exec = new ModelExecutor({ logLevel: 'silent' });
assert(typeof exec === 'object', 'ModelExecutor instance created');
assert(exec.timeout === 15000, 'Default timeout is 15000');
assert(exec.logLevel === 'silent', 'Log level set to silent');
assert(typeof exec.execute === 'function', 'execute() method exists');
assert(typeof exec.tryModel === 'function', 'tryModel() method exists');

// ─── Test 2: Chain Selection ───────────────────────────────────
console.log('\n[Chain Selection]');
assert(exec.getChainForComplexity(1) === 'cheap', 'complexity 1 -> cheap');
assert(exec.getChainForComplexity(2) === 'cheap', 'complexity 2 -> cheap');
assert(exec.getChainForComplexity(3) === 'medium', 'complexity 3 -> medium');
assert(exec.getChainForComplexity(4) === 'premium', 'complexity 4 -> premium');
assert(exec.getChainForComplexity(5) === 'premium', 'complexity 5 -> premium');
assert(exec.getChainForComplexity(0) === 'cheap', 'complexity 0 (invalida) -> cheap');
assert(exec.getChainForComplexity(6) === 'cheap', 'complexity 6 (invalida) -> cheap (clamped to 1)');

// ─── Test 3: buildChain ────────────────────────────────────────
console.log('\n[buildChain]');
const chain1 = exec.buildChain('query', 1);
assert(chain1.tier === 'cheap', 'chain query/1 tier=cheap');
assert(Array.isArray(chain1.models), 'chain.models is array');
assert(chain1.models.length > 0, 'chain.models non-empty');
assert(typeof chain1.timeout === 'number', 'chain.timeout is number');

const chain3 = exec.buildChain('code', 3);
assert(chain3.tier === 'medium', 'chain code/3 tier=medium');
assert(chain3.models.length >= 2, 'medium chain has >= 2 models');

const chain5 = exec.buildChain('analysis', 5);
assert(chain5.tier === 'premium', 'chain analysis/5 tier=premium');
assert(chain5.models.length >= 2, 'premium chain has >= 2 models');

// ─── Test 4: DEFAULT_CHAINS Structure ──────────────────────────
console.log('\n[DEFAULT_CHAINS]');
assert(typeof DEFAULT_CHAINS === 'object', 'DEFAULT_CHAINS is object');
assert('cheap' in DEFAULT_CHAINS, 'Has cheap chain');
assert('medium' in DEFAULT_CHAINS, 'Has medium chain');
assert('premium' in DEFAULT_CHAINS, 'Has premium chain');
assert(DEFAULT_CHAINS.cheap.models[0] === 'oc/deepseek-v4-flash-free', 'cheap[0] is deepseek');
assert(DEFAULT_CHAINS.cheap.models[1] === 'gc/gemini-2.5-flash', 'cheap[1] is gemini');
assert(DEFAULT_CHAINS.medium.models[0] === 'gc/gemini-2.5-flash', 'medium[0] is gemini');
assert(DEFAULT_CHAINS.medium.models[2] === 'ag/claude-sonnet-4-6', 'medium[2] is claude');
assert(DEFAULT_CHAINS.premium.models[0] === 'ag/claude-sonnet-4-6', 'premium[0] is claude');

// ─── Test 5: Custom Chains ─────────────────────────────────────
console.log('\n[Custom Chains]');
const customConfig = {
  logLevel: 'silent',
  chains: {
    cheap: { models: ['gc/gemini-2.5-flash'], timeout: 5000 }
  }
};
const customExec = new ModelExecutor(customConfig);
const customChain = customExec.buildChain('query', 1);
assert(customChain.models[0] === 'gc/gemini-2.5-flash', 'Custom cheap model applied');
assert(customChain.timeout === 5000, 'Custom cheap timeout applied');

// Default chains should still have medium/premium
const customMedium = customExec.buildChain('code', 3);
assert(customMedium.models[0] === 'gc/gemini-2.5-flash', 'Default medium preserved');

// ─── Test 6: ModelExecutionError ────────────────────────────────
console.log('\n[ModelExecutionError]');
const attempts = [
  { model: 'model-a', status: 'error', duration: 1000, error: 'timeout' },
  { model: 'model-b', status: 'failed', duration: 2000, error: 'invalid response' }
];
const err = new ModelExecutionError('Todos falharam', attempts);
assert(err.name === 'ModelExecutionError', 'Error name is ModelExecutionError');
assert(err.message === 'Todos falharam', 'Error message set');
assert(Array.isArray(err.attempts), 'Error has attempts array');
assert(err.attempts.length === 2, 'Error has 2 attempts');
assert(typeof err.getSummary() === 'string', 'getSummary() returns string');
assert(err.getSummary().indexOf('model-a') !== -1, 'Summary contains model-a');
assert(err.getSummary().indexOf('model-b') !== -1, 'Summary contains model-b');

const json = err.toJSON();
assert(json.name === 'ModelExecutionError', 'toJSON().name');
assert(json.timestamp !== undefined, 'toJSON().timestamp');

// ─── Test 7: getConfig ──────────────────────────────────────────
console.log('\n[getConfig]');
const cfg = exec.getConfig();
assert(typeof cfg === 'object', 'getConfig() returns object');
assert(cfg.timeout === 15000, 'Config has timeout');
assert(cfg.logLevel === 'silent', 'Config has logLevel');
assert(typeof cfg.chains === 'object', 'Config has chains');
assert('cheap' in cfg.chains, 'Config has cheap chain');
assert('apiBaseUrl' in cfg, 'Config has apiBaseUrl');

// ─── Test 8: Stats ──────────────────────────────────────────────
console.log('\n[Stats]');
const stats = exec.getStats();
assert(typeof stats === 'object', 'getStats() returns object');
assert(stats.totalExecutions === 0, 'Initial totalExecutions = 0');
assert(typeof stats.modelStats === 'object', 'Has modelStats');

exec.resetStats();
const resetStats = exec.getStats();
assert(resetStats.totalExecutions === 0, 'After reset, totalExecutions = 0');
assert(resetStats.totalAttempts === 0, 'After reset, totalAttempts = 0');

// ─── Test 9: tryModel (sem servidor real) ──────────────────────
console.log('\n[tryModel (error scenarios)]');
(async function() {
  // Test with unreachable server (should fail gracefully)
  const result = await exec.tryModel('oc/deepseek-v4-flash-free', 'test prompt', 1000);
  assert(result.success === false, 'tryModel contra servidor inexistente falha');
  assert(typeof result.duration === 'number', 'tryModel retorna duration');
  assert(result.error !== null, 'tryModel retorna mensagem de erro');
  assert(result.model === 'oc/deepseek-v4-flash-free', 'tryModel retorna model name');

  // Test extractOutput
  console.log('\n[_extractOutput]');
  const output1 = exec._extractOutput(JSON.stringify({
    choices: [{ message: { content: 'Hello World' } }]
  }), 'test');
  assert(output1 === 'Hello World', 'Extract OpenAI format');

  const output2 = exec._extractOutput('Raw text response', 'test');
  assert(output2 === 'Raw text response', 'Extract raw text');

  const output3 = exec._extractOutput(JSON.stringify({ response: 'Hi' }), 'test');
  assert(output3 === 'Hi', 'Extract { response } format');

  const output4 = exec._extractOutput('', 'test');
  assert(output4 === null, 'Extract empty string returns null');

  const output5 = exec._extractOutput(null, 'test');
  assert(output5 === null, 'Extract null returns null');

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log('  Passed: ' + passed);
  console.log('  Failed: ' + failed);
  console.log('');
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED');
  }
})().catch(function(e) {
  console.error('Test error:', e.message);
  process.exit(1);
});
