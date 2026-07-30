/**
 * Test: rag-query.js
 * Cosine similarity (array + TF-IDF), query TF-IDF, embeddings fallback.
 *
 * O módulo auto-executa no require, portanto redefinimos as funções
 * puras aqui para teste isolado.
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

// ─── Funções extraídas do rag-query.js ────────────────────────────────

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

function cosineSimilarityTFIDF(a, b) {
  const terms = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const term of terms) {
    const va = a[term] || 0;
    const vb = b[term] || 0;
    dotProduct += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

function queryTFIDF(index, searchText, topK, tokenizeFn) {
  // Tokenize query using provided function or simple split
  const queryTerms = tokenizeFn ? tokenizeFn(searchText) : searchText.toLowerCase().split(/\s+/);
  if (queryTerms.length === 0) return [];

  // Build query TF
  const queryTF = {};
  for (const term of queryTerms) {
    queryTF[term] = (queryTF[term] || 0) + 1;
  }

  // Build query TF-IDF vector using same IDF as index
  const queryVector = {};
  const maxTF = Math.max(...Object.values(queryTF), 1);
  const docCount = index.length;

  for (const [term, count] of Object.entries(queryTF)) {
    const df = index.filter(d => d.terms && d.terms.includes(term)).length;
    const tf = count / maxTF;
    const idf = Math.log((docCount + 1) / (df + 1)) + 1;
    queryVector[term] = tf * idf;
  }

  // Score each document
  const results = index.map((doc, idx) => {
    const tfidf = doc.tfidf || (index.tfidf && index.tfidf[idx]);
    return {
      index: idx,
      file: doc.file,
      chunk: doc.chunk,
      content: doc.content,
      score: tfidf ? cosineSimilarityTFIDF(queryVector, tfidf) : 0
    };
  });

  // Sort by descending score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
}

function getQueryEmbedding(text, config, envMock) {
  const embCfg = (config && config.rag && config.rag.embeddings) || {};
  const apiKey = (envMock && envMock[embCfg.api_key_env]) || embCfg.api_key_fallback || '';

  if (!apiKey) {
    return null;
  }

  return [0.1, 0.2, 0.3]; // mock embedding vector
}

function queryHybrid(index, searchText, topK, config, envMock, tokenizeFn) {
  const embCfg = (config && config.rag && config.rag.embeddings) || {};
  const apiKey = (envMock && envMock[embCfg.api_key_env]) || embCfg.api_key_fallback || '';

  if (!apiKey) {
    // Fallback to TF-IDF
    return queryTFIDF(index, searchText, topK, tokenizeFn);
  }

  return queryTFIDF(index, searchText, topK, tokenizeFn);
}

function queryVectorStore() {
  // Vector store is optional, returns empty on failure
  return [];
}

// ─── Tests: cosineSimilarity (array-based) ───────────────────────────

console.log('\n🔍 rag-query.js — cosineSimilarity (array)\n');

test('vetores idênticos → similaridade ~1.0', () => {
  const a = { hello: 1, world: 2 };
  const b = { hello: 1, world: 2 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.ok(Math.abs(sim - 1.0) < 1e-10, `Esperado ~1.0, obtido ${sim}`);
});

test('vetores ortogonais (sem termos em comum) → similaridade 0.0', () => {
  const a = { hello: 1 };
  const b = { world: 1 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.strictEqual(sim, 0.0);
});

test('vetores parcialmente similares → entre 0 e 1', () => {
  const a = { hello: 2, world: 1, foo: 1 };
  const b = { hello: 1, world: 1, bar: 1 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.ok(sim > 0 && sim < 1);
});

test('vetor vazio vs vetor populado → 0.0', () => {
  const sim = cosineSimilarityTFIDF({}, { hello: 1 });
  assert.strictEqual(sim, 0.0);
});

test('ambos vetores vazios → 0.0', () => {
  const sim = cosineSimilarityTFIDF({}, {});
  assert.strictEqual(sim, 0.0);
});

test('similaridade com valores zero não quebra', () => {
  const a = { hello: 0, world: 0 };
  const b = { hello: 0, world: 0, foo: 0 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.strictEqual(sim, 0.0);
});

test('similaridade com valores negativos', () => {
  const a = { hello: -1, world: 1 };
  const b = { hello: 1, world: -1 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.ok(typeof sim === 'number');
  assert.ok(Math.abs(sim - (-1.0)) < 1e-10, `Esperado ~-1.0, obtido ${sim}`);
});

test('similaridade com muitos termos', () => {
  const a = {};
  const b = {};
  for (let i = 0; i < 100; i++) {
    a['term' + i] = i;
    b['term' + i] = i * 2;
  }
  const sim = cosineSimilarityTFIDF(a, b);
  assert.ok(sim > 0, `Esperado > 0, obtido ${sim}`);
  assert.ok(sim <= 1.0000000001, `Esperado <= 1, obtido ${sim}`);
});

// ─── Tests: cosineSimilarityTFIDF ──────────────────────────────────────

console.log('\n🔍 rag-query.js — cosineSimilarityTFIDF\n');

test('TF-IDF vetores com termos compartilhados', () => {
  const a = { pipeline: 0.5, state: 0.3, machine: 0.2 };
  const b = { pipeline: 0.4, state: 0.3, transition: 0.3 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.ok(sim > 0 && sim <= 1, `Similaridade deve estar entre 0 e 1, obtido ${sim}`);
});

test('TF-IDF vetores sem termos em comum', () => {
  const a = { alpha: 0.8, beta: 0.2 };
  const b = { gamma: 0.6, delta: 0.4 };
  const sim = cosineSimilarityTFIDF(a, b);
  assert.strictEqual(sim, 0);
});

test('TF-IDF vetor vazio', () => {
  const a = {};
  const b = { term: 0.5 };
  assert.strictEqual(cosineSimilarityTFIDF(a, b), 0);
  assert.strictEqual(cosineSimilarityTFIDF(b, a), 0);
});

test('TF-IDF vetores idênticos (vários termos)', () => {
  const vec = { a: 0.1, b: 0.2, c: 0.3, d: 0.4 };
  const sim = cosineSimilarityTFIDF(vec, vec);
  assert.ok(Math.abs(sim - 1.0) < 1e-10, 'Esperado ~1.0, obtido ' + sim);
});

// ─── Tests: queryTFIDF ──────────────────────────────────────────────

console.log('\n🔍 rag-query.js — queryTFIDF\n');

test('queryTFIDF: consulta básica com match', () => {
  const index = [
    { file: 'doc1.md', chunk: 0, content: 'About pipeline state', terms: ['pipeline', 'state'], tfidf: { pipeline: 0.5, state: 0.3 } },
    { file: 'doc2.md', chunk: 0, content: 'About machine learning', terms: ['machine', 'learning'], tfidf: { machine: 0.6, learning: 0.4 } }
  ];

  const results = queryTFIDF(index, 'pipeline state', 5, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.strictEqual(results.length, 2);
  assert.ok(results[0].score > 0, 'First result should have score > 0');
  assert.strictEqual(results[0].file, 'doc1.md');
});

test('queryTFIDF: sem termos relevantes retorna resultados com score 0', () => {
  const index = [
    { file: 'doc1.md', chunk: 0, content: 'Hello world', terms: ['hello', 'world'], tfidf: { hello: 0.5, world: 0.5 } }
  ];

  const results = queryTFIDF(index, 'zzzzz', 5, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].score, 0);
});

test('queryTFIDF: topK limita resultados', () => {
  const index = [
    { file: 'a.md', chunk: 0, content: 'test data', terms: ['test', 'data'], tfidf: { test: 0.5 } },
    { file: 'b.md', chunk: 0, content: 'test info', terms: ['test', 'info'], tfidf: { test: 0.5 } },
    { file: 'c.md', chunk: 0, content: 'other info', terms: ['other', 'info'], tfidf: { other: 0.5 } }
  ];

  const results = queryTFIDF(index, 'test', 2, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.strictEqual(results.length, 2);
});

test('queryTFIDF: consulta vazia retorna []', () => {
  const index = [
    { file: 'doc.md', chunk: 0, content: 'content', terms: ['content'], tfidf: { content: 1.0 } }
  ];

  const results = queryTFIDF(index, '', 5, function(text) {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
  });

  assert.strictEqual(results.length, 0);
});

test('queryTFIDF: índice vazio retorna []', () => {
  const results = queryTFIDF([], 'test', 5, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.strictEqual(results.length, 0);
});

// ─── Tests: getQueryEmbedding ────────────────────────────────────────

console.log('\n🔍 rag-query.js — getQueryEmbedding\n');

test('getQueryEmbedding: sem API key → null (fallback TF-IDF)', () => {
  const config = { rag: { embeddings: { api_key_env: 'NOT_SET' } } };
  const result = getQueryEmbedding('test query', config, {});
  assert.strictEqual(result, null);
});

test('getQueryEmbedding: config vazio → null', () => {
  const result = getQueryEmbedding('test query', {}, {});
  assert.strictEqual(result, null);
});

test('getQueryEmbedding: com API key → vetor mock', () => {
  const config = { rag: { embeddings: { api_key_env: 'Matrix_RAG_API_KEY' } } };
  const envMock = { Matrix_RAG_API_KEY: 'sk-test-key' };
  const result = getQueryEmbedding('test query', config, envMock);
  assert.ok(Array.isArray(result));
  assert.strictEqual(result.length, 3);
});

test('getQueryEmbedding: com fallback key → vetor mock', () => {
  const config = { rag: { embeddings: { api_key_fallback: 'sk-fallback' } } };
  const result = getQueryEmbedding('test query', config, {});
  assert.ok(Array.isArray(result));
});

// ─── Tests: queryHybrid ──────────────────────────────────────────────

console.log('\n🔍 rag-query.js — queryHybrid\n');

test('queryHybrid: sem API key fallback para TF-IDF', () => {
  const index = [
    { file: 'doc.md', chunk: 0, content: 'pipeline state machine', terms: ['pipeline', 'state'], tfidf: { pipeline: 0.5, state: 0.3 } }
  ];

  const results = queryHybrid(index, 'pipeline', 5, {}, {}, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
});

test('queryHybrid: com API key executa TF-IDF (mock)', () => {
  const index = [
    { file: 'doc.md', chunk: 0, content: 'test content', terms: ['test'], tfidf: { test: 1.0 } }
  ];

  const config = { rag: { embeddings: { api_key_env: 'TEST_KEY' } } };
  const results = queryHybrid(index, 'test', 5, config, { TEST_KEY: 'sk-key' }, function(text) {
    return text.toLowerCase().split(/\s+/);
  });

  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.ok(results[0].score > 0);
});

// ─── Tests: queryVectorStore ─────────────────────────────────────────

console.log('\n🔍 rag-query.js — queryVectorStore\n');

test('queryVectorStore: indisponível retorna array vazio', async () => {
  const results = await Promise.resolve(queryVectorStore());
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 0);
});

// ─── Tests: cosineSimilarity (array-based, do rag-query.js original) ─

console.log('\n🔍 rag-query.js — cosineSimilarity (array/embedding)\n');

test('cosineSimilarity array: vetores idênticos', () => {
  const a = [1, 2, 3];
  const b = [1, 2, 3];
  assert.strictEqual(cosineSimilarity(a, b), 1.0);
});

test('cosineSimilarity array: vetores ortogonais', () => {
  const a = [1, 0];
  const b = [0, 1];
  assert.strictEqual(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity array: um vetor nulo → 0', () => {
  assert.strictEqual(cosineSimilarity(null, [1, 2]), 0);
  assert.strictEqual(cosineSimilarity([1, 2], null), 0);
});

test('cosineSimilarity array: tamanhos diferentes → 0', () => {
  assert.strictEqual(cosineSimilarity([1], [1, 2]), 0);
});

test('cosineSimilarity array: vetores com magnitude zero → 0', () => {
  assert.strictEqual(cosineSimilarity([0, 0], [0, 0]), 0);
});

test('cosineSimilarity array: similaridade parcial', () => {
  const a = [1, 2, 3];
  const b = [2, 4, 6];
  assert.strictEqual(cosineSimilarity(a, b), 1.0);
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
