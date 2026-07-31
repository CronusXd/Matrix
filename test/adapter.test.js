'use strict';

/**
 * Test Suite: Provider Adapter Bridge
 * ====================================
 * Tests for src/providers/adapter.js
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.error(`  \u2717 ${msg}`); }
}

async function run() {
  console.log('\n=== [Provider Adapter Bridge Tests] ===\n');

  const adapterModule = require('../src/providers/adapter');

  // ── createAdapter ────────────────────────────────────────────────────────
  console.log('--- createAdapter ---');

  // Test: throws on null provider
  try {
    adapterModule.createAdapter(null, { apiKey: 'test' });
    assert(false, 'createAdapter(null) should throw');
  } catch (e) {
    assert(e.message.includes('required'), 'createAdapter(null) throws');
  }

  // Test: throws on undefined provider
  try {
    adapterModule.createAdapter(undefined, { apiKey: 'test' });
    assert(false, 'createAdapter(undefined) should throw');
  } catch (e) {
    assert(e.message.includes('required'), 'createAdapter(undefined) throws');
  }

  // Test: throws on provider without chat()
  try {
    adapterModule.createAdapter({ noChat: true }, { apiKey: 'test' });
    assert(false, 'createAdapter(no chat) should throw');
  } catch (e) {
    assert(e.message.includes('chat()'), 'createAdapter(no chat) throws descriptive error');
  }

  // Test: creates adapter with valid provider
  const mockProvider = {
    chat: async () => ({ content: 'hello', usage: { total_tokens: 10 } })
  };
  const adapter = adapterModule.createAdapter(mockProvider, { apiKey: 'sk-test', model: 'test-model' });
  assert(adapter !== null && adapter !== undefined, 'createAdapter returns adapter object');
  assert(typeof adapter.call === 'function', 'adapter has call() method');
  assert(typeof adapter.models === 'function', 'adapter has models() method');
  assert(typeof adapter.health === 'function', 'adapter has health() method');
  assert(adapter._provider === mockProvider, 'adapter exposes _provider');
  assert(adapter._params.apiKey === 'sk-test', 'adapter stores apiKey in _params');
  assert(adapter._params.model === 'test-model', 'adapter stores model in _params');

  // ── buildMessages ────────────────────────────────────────────────────────
  console.log('\n--- buildMessages ---');

  // Test: string input
  const msgString = adapterModule.buildMessages('hello world');
  assert(Array.isArray(msgString), 'buildMessages(string) returns array');
  assert(msgString.length === 1, 'buildMessages(string) returns 1 message');
  assert(msgString[0].role === 'user', 'buildMessages(string) role is user');
  assert(msgString[0].content === 'hello world', 'buildMessages(string) preserves content');

  // Test: {system, user} object
  const msgObj = adapterModule.buildMessages({ system: 'You are helpful', user: 'Hi' });
  assert(msgObj.length === 2, 'buildMessages({system, user}) returns 2 messages');
  assert(msgObj[0].role === 'system', 'buildMessages first role is system');
  assert(msgObj[1].role === 'user', 'buildMessages second role is user');

  // Test: {system} only
  const msgSystemOnly = adapterModule.buildMessages({ system: 'system only test' });
  assert(msgSystemOnly.length === 1, 'buildMessages({system}) returns 1 message');
  assert(msgSystemOnly[0].role === 'system', 'buildMessages({system}) role is system');

  // Test: {user} only
  const msgUserOnly = adapterModule.buildMessages({ user: 'user only test' });
  assert(msgUserOnly.length === 1, 'buildMessages({user}) returns 1 message');
  assert(msgUserOnly[0].role === 'user', 'buildMessages({user}) role is user');

  // Test: empty system
  const msgEmptySystem = adapterModule.buildMessages({ system: '   ', user: 'test' });
  assert(msgEmptySystem.length === 1, 'buildMessages(empty system) skips empty system message');
  assert(msgEmptySystem[0].role === 'user', 'buildMessages(empty system) keeps user message');

  // Test: {messages} array
  const msgPrebuilt = adapterModule.buildMessages({
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]
  });
  assert(msgPrebuilt.length === 2, 'buildMessages({messages}) returns 2 messages');
  assert(msgPrebuilt[0].role === 'system', 'buildMessages({messages}) preserves roles');

  // Test: array input
  const msgArray = adapterModule.buildMessages([
    { role: 'user', content: 'test' }
  ]);
  assert(msgArray.length === 1, 'buildMessages(array) returns 1 message');
  assert(msgArray[0].content === 'test', 'buildMessages(array) preserves content');

  // Test: fallback for non-standard input
  const msgFallback = adapterModule.buildMessages({ random: 'data', foo: 'bar' });
  assert(msgFallback.length === 1, 'buildMessages(fallback) returns 1 message');
  assert(msgFallback[0].role === 'user', 'buildMessages(fallback) default role is user');

  // Test: undefined/empty
  const msgEmpty = adapterModule.buildMessages('');
  assert(msgEmpty.length === 1, 'buildMessages(empty string) returns 1 message');
  assert(msgEmpty[0].role === 'user', 'buildMessages(empty string) role is user');

  // ── normalizeParams ──────────────────────────────────────────────────────
  console.log('\n--- normalizeParams ---');

  const params1 = adapterModule.normalizeParams({});
  assert(params1.temperature === 0.7, 'normalizeParams default temperature is 0.7');
  assert(params1.max_tokens === 4096, 'normalizeParams default max_tokens is 4096');
  assert(params1.model === 'deepseek-chat', 'normalizeParams default model is deepseek-chat');
  assert(params1.apiKey === '', 'normalizeParams default apiKey is empty string');

  const params2 = adapterModule.normalizeParams({
    apiKey: 'sk-custom',
    model: 'gpt-4',
    temperature: 0.2,
    max_tokens: 2048
  });
  assert(params2.apiKey === 'sk-custom', 'normalizeParams preserves custom apiKey');
  assert(params2.model === 'gpt-4', 'normalizeParams preserves custom model');
  assert(params2.temperature === 0.2, 'normalizeParams preserves custom temperature');
  assert(params2.max_tokens === 2048, 'normalizeParams preserves custom max_tokens');

  // Test: temperature 0 is valid (not treated as falsy)
  const params3 = adapterModule.normalizeParams({ temperature: 0 });
  assert(params3.temperature === 0, 'normalizeParams preserves temperature=0');

  // ── normalizeResult ──────────────────────────────────────────────────────
  console.log('\n--- normalizeResult ---');

  const rawResult = {
    content: 'test content',
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    model: 'custom-model'
  };
  const normalized = adapterModule.normalizeResult(rawResult, { model: 'default-model' });
  assert(normalized.content === 'test content', 'normalizeResult preserves content');
  assert(normalized.usage.prompt_tokens === 100, 'normalizeResult preserves prompt_tokens');
  assert(normalized.usage.completion_tokens === 50, 'normalizeResult preserves completion_tokens');
  assert(normalized.usage.total_tokens === 150, 'normalizeResult preserves total_tokens');
  assert(normalized.model === 'custom-model', 'normalizeResult uses result model over params');
  assert(normalized.metadata.adapterVersion === '1.0.0', 'normalizeResult includes adapter version');

  // Test: missing usage
  const noUsage = adapterModule.normalizeResult({ content: 'x' }, { model: 'm' });
  assert(noUsage.usage.total_tokens === 0, 'normalizeResult defaults usage to 0 when missing');
  assert(noUsage.model === 'm', 'normalizeResult falls back to params model when result has none');

  // ── wrapError ────────────────────────────────────────────────────────────
  console.log('\n--- wrapError ---');

  const err1 = adapterModule.wrapError(new Error('test error'), 'test-source');
  assert(err1.message.startsWith('[Matrix Adapter]'), 'wrapError adds [Matrix Adapter] prefix');
  assert(err1.message.includes('test error'), 'wrapError preserves original message');
  assert(err1.message.includes('test-source'), 'wrapError includes source');
  assert(err1.originalError !== undefined, 'wrapError preserves originalError reference');

  // Test: null error
  const err2 = adapterModule.wrapError(null, 'null-source');
  assert(err2.message.includes('Unknown error'), 'wrapError handles null error');

  // Test: already wrapped
  const preWrapped = new Error('[Matrix Adapter] already wrapped');
  const err3 = adapterModule.wrapError(preWrapped, 'another-source');
  assert(err3.message === '[Matrix Adapter] already wrapped', 'wrapError does not double-wrap');

  // Test: preserves status code
  const apiErr = new Error('API Error');
  apiErr.statusCode = 429;
  apiErr.responseBody = '{"error":"rate limit"}';
  const err4 = adapterModule.wrapError(apiErr, 'api-call');
  assert(err4.statusCode === 429, 'wrapError preserves statusCode');
  assert(err4.responseBody === '{"error":"rate limit"}', 'wrapError preserves responseBody');

  // ── adapter.call() ───────────────────────────────────────────────────────
  console.log('\n--- adapter.call() ---');

  // Test: string call
  const strProvider = {
    chat: async (messages, params) => ({
      content: `Got ${messages.length} message(s), model: ${params.model}`,
      usage: { total_tokens: 5 }
    })
  };
  const strAdapter = adapterModule.createAdapter(strProvider, { apiKey: 'k', model: 'test' });
  const strResult = await strAdapter.call('hello');
  assert(strResult.content.includes('Got'), 'adapter.call(string) works');
  assert(strResult.usage.total_tokens === 5, 'adapter.call(string) returns usage');
  assert(strResult.model === 'test', 'adapter.call(string) returns model');

  // Test: {system, user} call
  const objResult = await strAdapter.call({ system: 'sys prompt', user: 'user query' });
  assert(objResult.content.includes('2 message'), 'adapter.call({system,user}) sends 2 messages');
  assert(typeof objResult.content === 'string', 'adapter.call returns string content');

  // Test: models() on provider without models
  const noModelsAdapter = adapterModule.createAdapter(
    { chat: async () => ({ content: 'x' }) },
    { apiKey: 'k' }
  );
  const models = await noModelsAdapter.models();
  assert(Array.isArray(models), 'adapter.models() returns array even without provider.models');
  assert(models.length === 0, 'adapter.models() returns empty when provider has no models');

  // Test: health() on provider
  const healthResult = await noModelsAdapter.health();
  assert(healthResult === true, 'adapter.health() returns true when provider has no health');

  // Test: error propagation
  const errorProvider = {
    chat: async () => { throw new Error('provider down'); }
  };
  const errorAdapter = adapterModule.createAdapter(errorProvider, { apiKey: 'k' });
  try {
    await errorAdapter.call('test');
    assert(false, 'adapter.call should throw on provider error');
  } catch (e) {
    assert(e.message.includes('[Matrix Adapter]'), 'adapter wraps provider errors');
    assert(e.message.includes('provider down'), 'adapter preserves provider error message');
  }

  // Print results
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test suite crashed:', err); process.exit(1); });
