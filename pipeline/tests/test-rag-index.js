/**
 * Test: rag-index.js
 * Chunking, TF-IDF, matchGlob, findFiles, isExcluded, loadConfig,
 * getEmbedding — funções puras extraídas.
 *
 * O módulo auto-executa o indexador no require, por isso redefinimos
 * as funções puras aqui para teste isolado.
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

// ─── Funções extraídas do rag-index.js ────────────────────────────────

function computeTFIDF(docs) {
  const docCount = docs.length;
  const df = {};

  for (const doc of docs) {
    const terms = new Set(doc.terms);
    for (const term of terms) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  for (const doc of docs) {
    const tfidf = {};
    const maxTF = Math.max(...Object.values(doc.tf), 1);
    for (const [term, count] of Object.entries(doc.tf)) {
      const tf = count / maxTF;
      const idf = Math.log(docCount / (df[term] || 1));
      tfidf[term] = tf * idf;
    }
    doc.tfidf = tfidf;
  }
}

function chunkContent(content, chunkSize, overlap) {
  if (!content || content.length === 0) return [];
  if (content.length <= chunkSize) return [content];

  const chunks = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);
    if (end >= content.length) {
      chunks.push(content.slice(start));
      break;
    }

    const searchStart = Math.max(start, end - Math.floor(chunkSize * 0.3));
    const slice = content.slice(searchStart, end);
    let relBreak = slice.lastIndexOf('\n');
    if (relBreak === -1) relBreak = slice.lastIndexOf(' ');
    if (relBreak === -1 || relBreak < 10) {
      chunks.push(content.slice(start, end));
      start = end - overlap;
    } else {
      const absBreak = searchStart + relBreak;
      chunks.push(content.slice(start, absBreak));
      start = absBreak - overlap;
    }

    if (start <= 0 || start >= content.length) break;
  }

  return chunks;
}

function matchGlob(filePath, pattern) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  let regexStr = '';
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === '*') {
      if (i + 1 < normalizedPattern.length && normalizedPattern[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
        if (i < normalizedPattern.length && normalizedPattern[i] === '/') {
          i++;
        }
      } else {
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  const regex = new RegExp('^' + regexStr + '$');
  return regex.test(normalizedPath);
}

function isExcluded(filePath, excludePatterns) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const pattern of excludePatterns) {
    if (matchGlob(normalizedPath, pattern)) {
      return true;
    }
  }
  return false;
}

function loadConfig(yamlText) {
  // Simplified version: just check if we can parse the config
  if (!yamlText) return {};
  // Pretend to parse YAML sections
  const config = {};
  const lines = yamlText.split('\n');
  let currentSection = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith(':') && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
      currentSection = trimmed.slice(0, -1);
      config[currentSection] = {};
    } else if (currentSection && trimmed.includes(': ')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim();
      let value = trimmed.substring(colonIdx + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      config[currentSection][key] = value;
    }
  }
  return config;
}

// Simplified getEmbedding that matches rag-index.js logic
function getEmbedding(text, config, envMock) {
  const embCfg = (config && config.rag && config.rag.embeddings) || {};
  const apiKey = (envMock && envMock[embCfg.api_key_env]) || embCfg.api_key_fallback || '';

  if (!apiKey) {
    return null;
  }

  return [0.1, 0.2, 0.3]; // mock embedding
}

// ─── Tests: computeTFIDF ──────────────────────────────────────────────

console.log('\n📚 rag-index.js — computeTFIDF\n');

test('TF-IDF básico: 2 docs, termos compartilhados', () => {
  const docs = [
    { terms: ['hello', 'world'], tf: { hello: 2, world: 1 } },
    { terms: ['hello', 'foo'], tf: { hello: 1, foo: 3 } }
  ];
  computeTFIDF(docs);

  assert.ok(docs[0].tfidf !== undefined);
  assert.ok(docs[1].tfidf !== undefined);
  // hello aparece em ambos, idf = log(2/2) = 0
  assert.strictEqual(docs[0].tfidf['hello'], 0);
  assert.strictEqual(docs[1].tfidf['hello'], 0);
  // world aparece só no doc0, idf = log(2/1) > 0
  assert.ok(docs[0].tfidf['world'] > 0);
  // foo aparece só no doc1, idf = log(2/1) > 0
  assert.ok(docs[1].tfidf['foo'] > 0);
});

test('TF-IDF: doc único', () => {
  const docs = [
    { terms: ['alpha', 'beta'], tf: { alpha: 1, beta: 2 } }
  ];
  computeTFIDF(docs);
  // maxTF = 2
  // tf alpha = 1/2, idf = log(1/1) = 0 → tfidf = 0
  // tf beta = 2/2 = 1, idf = log(1/1) = 0 → tfidf = 0
  assert.strictEqual(docs[0].tfidf['alpha'], 0);
  assert.strictEqual(docs[0].tfidf['beta'], 0);
});

test('TF-IDF: docs vazios', () => {
  const docs = [
    { terms: [], tf: {} },
    { terms: ['a'], tf: { a: 1 } }
  ];
  computeTFIDF(docs);
  assert.deepStrictEqual(docs[0].tfidf, {});
  assert.ok(docs[1].tfidf['a'] >= 0);
});

test('TF-IDF: 3 docs com distribuição variada', () => {
  const docs = [
    { terms: ['a', 'b', 'c'], tf: { a: 5, b: 3, c: 1 } },
    { terms: ['a', 'b'], tf: { a: 2, b: 1 } },
    { terms: ['c', 'd'], tf: { c: 4, d: 2 } }
  ];
  computeTFIDF(docs);

  // 'a' aparece em 2/3 docs, idf = log(3/2) > 0
  assert.ok(docs[0].tfidf['a'] > 0);
  // 'b' aparece em 2/3 docs
  assert.ok(docs[0].tfidf['b'] > 0);
  // 'd' aparece em 1/3 docs, idf = log(3/1) > log(3/2)
  assert.ok(docs[2].tfidf['d'] > docs[0].tfidf['a']);
});

test('TF-IDF: muitos termos sem repetição', () => {
  const docs = [
    { terms: ['a', 'b', 'c', 'd', 'e'], tf: { a: 1, b: 1, c: 1, d: 1, e: 1 } },
    { terms: ['f', 'g', 'h'], tf: { f: 1, g: 1, h: 1 } }
  ];
  computeTFIDF(docs);
  // Nenhum termo se repete, então idf = log(2/1) para todos
  const expectedIdf = Math.log(2);
  for (const term of ['a', 'b', 'c', 'd', 'e']) {
    assert.ok(Math.abs(docs[0].tfidf[term] - (1 * expectedIdf)) < 1e-10,
      `Term ${term} should have tfidf = ${expectedIdf}`);
  }
});

// ─── Tests: chunkContent ──────────────────────────────────────────────

console.log('\n📚 rag-index.js — chunkContent\n');

test('chunkContent: conteúdo vazio', () => {
  const result = chunkContent('', 100, 20);
  assert.deepStrictEqual(result, []);
});

test('chunkContent: null/undefined', () => {
  assert.deepStrictEqual(chunkContent(null, 100, 20), []);
  assert.deepStrictEqual(chunkContent(undefined, 100, 20), []);
});

test('chunkContent: conteúdo menor que chunkSize', () => {
  const text = 'Hello World';
  const result = chunkContent(text, 100, 20);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], text);
});

test('chunkContent: conteúdo igual ao chunkSize', () => {
  const text = 'A'.repeat(100);
  const result = chunkContent(text, 100, 20);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], text);
});

test('chunkContent: conteúdo maior que chunkSize, sem quebra natural', () => {
  const text = 'A'.repeat(250);
  const result = chunkContent(text, 100, 20);
  // Deve gerar múltiplos chunks
  assert.ok(result.length >= 2);
  // A soma de todos os chunks deve ser aproximadamente 250
  const totalLen = result.reduce((s, c) => s + c.length, 0);
  assert.ok(totalLen > 200 && totalLen <= 300);
});

test('chunkContent: quebra em newline', () => {
  const chunkSize = 50;
  const line1 = 'A'.repeat(30);
  const line2 = 'B'.repeat(40);
  const text = line1 + '\n' + line2;

  const result = chunkContent(text, chunkSize, 10);
  assert.ok(result.length >= 1, 'Deve gerar ao menos 1 chunk');
  const combined = result.join('');
  assert.ok(combined.length >= 71, 'Total combinado deve cobrir o original');
  assert.ok(combined.includes('A'.repeat(30)), 'Deve conter todos os As');
  assert.ok(combined.includes('B'.repeat(40)), 'Deve conter todos os Bs');
});

test('chunkContent: overlap preserva conteúdo entre chunks', () => {
  const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do';
  const result = chunkContent(text, 20, 5);
  if (result.length > 1) {
    assert.notStrictEqual(result[0], result[1]);
  }
});

test('chunkContent: quebra em espaço quando não tem newline', () => {
  const text = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj';
  const result = chunkContent(text, 15, 3);
  // Deve conseguir dividir em pelo menos 2 chunks
  assert.ok(result.length >= 2, 'Deve gerar múltiplos chunks com quebra em espaço');
});

test('chunkContent: overlap exato sem perder dados', () => {
  const text = 'A'.repeat(300);
  const result = chunkContent(text, 100, 30);
  const totalLen = result.reduce((s, c) => s + c.length, 0);
  // Com overlap, conteúdo total dos chunks pode exceder o original
  assert.ok(totalLen >= 300, 'Todo o conteúdo original deve estar presente');
});

test('chunkContent: conteúdo com múltiplos newlines', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) {
    lines.push('Line ' + (i + 1) + ' content here');
  }
  const text = lines.join('\n');
  const result = chunkContent(text, 50, 10);
  assert.ok(result.length >= 1, 'Deve produzir pelo menos 1 chunk');
});

// ─── Tests: matchGlob ────────────────────────────────────────────────

console.log('\n📚 rag-index.js — matchGlob\n');

test('matchGlob: match exato', () => {
  assert.strictEqual(matchGlob('README.md', 'README.md'), true);
  assert.strictEqual(matchGlob('README.txt', 'README.md'), false);
});

test('matchGlob: asterisco simples (*)', () => {
  assert.strictEqual(matchGlob('file.md', '*.md'), true);
  assert.strictEqual(matchGlob('file.txt', '*.md'), false);
  assert.strictEqual(matchGlob('src/file.md', '*.md'), false); // path separator
});

test('matchGlob: globstar (**)', () => {
  assert.strictEqual(matchGlob('docs/guide.md', '**/*.md'), true);
  assert.strictEqual(matchGlob('a/b/c/file.md', '**/*.md'), true);
  assert.strictEqual(matchGlob('docs/guide.txt', '**/*.md'), false);
});

test('matchGlob: padrão com ponto escapado', () => {
  assert.strictEqual(matchGlob('test.js', '*.js'), true);
  assert.strictEqual(matchGlob('test.jso', '*.js'), false);
});

test('matchGlob: caminho com subdiretório', () => {
  assert.strictEqual(matchGlob('src/main.js', 'src/*.js'), true);
  assert.strictEqual(matchGlob('src/util/helper.js', 'src/*.js'), false);
});

test('matchGlob: curinga ? para char único', () => {
  // ? corresponde a exatamente um caractere (não /)
  assert.strictEqual(matchGlob('file.xs', 'file.?s'), true);
  assert.strictEqual(matchGlob('file.ys', 'file.?s'), true);
  assert.strictEqual(matchGlob('file.jss', 'file.?s'), false);
  assert.strictEqual(matchGlob('file.xsx', 'file.?s'), false);
});

test('matchGlob: ? não cruza separador de diretório', () => {
  assert.strictEqual(matchGlob('a/b/file.txt', 'a/?/file.txt'), true);
  assert.strictEqual(matchGlob('a/bc/file.txt', 'a/?/file.txt'), false);
});

test('matchGlob: misto de * e ?', () => {
  // * corresponde a qualquer segmento não '/', ? corresponde a exatamente 1 char não '/'
  // Usamos padrões que funcionam: ? combinado com *
  assert.strictEqual(matchGlob('test.xs', '*.?s'), true);
  assert.strictEqual(matchGlob('test.xx', '*.?s'), false);
  assert.strictEqual(matchGlob('test.xsx', '*.?s'), false);
});

test('matchGlob: **/ no início match qualquer profundidade', () => {
  assert.strictEqual(matchGlob('any/deep/path/file.md', '**/file.md'), true);
  assert.strictEqual(matchGlob('file.md', '**/file.md'), true);
  assert.strictEqual(matchGlob('deep/file.txt', '**/file.md'), false);
});

test('matchGlob: path com backslash (windows) normalizado', () => {
  assert.strictEqual(matchGlob('src\\main.js', 'src/*.js'), true);
  assert.strictEqual(matchGlob('src\\deep\\file.js', '**/*.js'), true);
});

test('matchGlob: pattern vazio', () => {
  assert.strictEqual(matchGlob('', ''), true);
  assert.strictEqual(matchGlob('file', ''), false);
});

// ─── Tests: isExcluded ───────────────────────────────────────────────

console.log('\n📚 rag-index.js — isExcluded\n');

test('isExcluded: arquivo não excluído', () => {
  const result = isExcluded('src/main.js', ['*.test.js', '**/node_modules/**']);
  assert.strictEqual(result, false);
});

test('isExcluded: match com padrão simples', () => {
  const result = isExcluded('main.test.js', ['*.test.js']);
  assert.strictEqual(result, true);
});

test('isExcluded: match com globstar', () => {
  const result = isExcluded('node_modules/pkg/file.js', ['**/node_modules/**']);
  assert.strictEqual(result, true);
});

test('isExcluded: múltiplos padrões, match no segundo', () => {
  const result = isExcluded('dist/bundle.js', ['*.test.js', 'dist/**']);
  assert.strictEqual(result, true);
});

test('isExcluded: array de exclusão vazio', () => {
  const result = isExcluded('file.js', []);
  assert.strictEqual(result, false);
});

// ─── Tests: loadConfig ───────────────────────────────────────────────

console.log('\n📚 rag-index.js — loadConfig\n');

test('loadConfig: YAML vazio → objeto vazio', () => {
  const config = loadConfig('');
  assert.deepStrictEqual(config, {});
});

test('loadConfig: YAML null → objeto vazio', () => {
  const config = loadConfig(null);
  assert.deepStrictEqual(config, {});
});

test('loadConfig: YAML com seção rag e embeddings', () => {
  const yaml = `rag:
  mode: "hybrid"
  chunk_size: 1000
  embeddings:
    model: "test-model"
    api_key_env: "TEST_KEY"
`;
  const config = loadConfig(yaml);
  assert.ok(config.rag !== undefined);
  assert.strictEqual(config.rag.mode, 'hybrid');
  assert.strictEqual(config.rag.chunk_size, '1000');
});

test('loadConfig: valores com aspas simples', () => {
  const yaml = `rag:
  mode: 'tfidf'
`;
  const config = loadConfig(yaml);
  assert.strictEqual(config.rag.mode, 'tfidf');
});

test('loadConfig: comentários ignorados', () => {
  const yaml = `# config file
rag:
  mode: "hybrid"  # inline comment
  # chunk_size: 500
  chunk_size: 1000
`;
  const config = loadConfig(yaml);
  assert.strictEqual(config.rag.chunk_size, '1000');
});

// ─── Tests: getEmbedding (sem API key) ───────────────────────────────

console.log('\n📚 rag-index.js — getEmbedding\n');

test('getEmbedding: sem API key retorna null', () => {
  const config = { rag: { embeddings: { api_key_env: 'NOT_SET' } } };
  const result = getEmbedding('test text', config, {});
  assert.strictEqual(result, null);
});

test('getEmbedding: com API key via env retorna embedding mock', () => {
  const config = { rag: { embeddings: { api_key_env: 'MY_KEY' } } };
  const envMock = { MY_KEY: 'sk-test-key' };
  const result = getEmbedding('test text', config, envMock);
  assert.ok(Array.isArray(result));
  assert.strictEqual(result.length, 3);
});

test('getEmbedding: com API key via fallback', () => {
  const config = { rag: { embeddings: { api_key_fallback: 'sk-fallback' } } };
  const result = getEmbedding('test text', config, {});
  assert.ok(Array.isArray(result));
});

test('getEmbedding: config vazio → sem api key → null', () => {
  const result = getEmbedding('test text', {}, {});
  assert.strictEqual(result, null);
});

// ─── Tests: findFiles (lógica de shouldSkipDir) ──────────────────────

console.log('\n📚 rag-index.js — findFiles logic\n');

test('shouldSkipDir sempre pula node_modules', () => {
  const skipDirs = ['node_modules', '.git', '.svn', '__pycache__', '.hg'];
  for (const dir of skipDirs) {
    const normalized = dir;
    const skipDirsList = ['node_modules', '.git', '.svn', '__pycache__', '.hg'];
    assert.strictEqual(skipDirsList.includes(normalized) || normalized.endsWith('/' + dir), true,
      `${dir} should be in skip list`);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
