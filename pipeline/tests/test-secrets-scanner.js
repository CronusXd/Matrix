/**
 * Test: secrets-scanner.js
 * Testa scanDirectory, detecção de padrões de secrets, run().
 *
 * Usa diretório temporário com arquivos simulados contendo secrets.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

// ─── Carrega o módulo (CLI não executa porque require.main !== module) ──
const scanner = require(path.join(__dirname, '..', 'scripts', 'secrets-scanner'));

// ─── Helpers para criar temp dir com arquivos ──────────────────────────
let tempDir = null;

function createTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
  return tempDir;
}

function createTempFile(relPath, content) {
  const fullPath = path.join(tempDir, relPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function cleanupTempDir() {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
    tempDir = null;
  }
}

// ─── Tests: PATTERNS ────────────────────────────────────────────────────

console.log('\n🔐 secrets-scanner.js — PATTERNS\n');

test('PATTERNS contém todos os padrões esperados', () => {
  const names = scanner.PATTERNS.map(function(p) { return p.name; });
  assert.ok(names.indexOf('AWS Access Key') !== -1);
  assert.ok(names.indexOf('GitHub Token') !== -1);
  assert.ok(names.indexOf('API Key genérica') !== -1);
  assert.ok(names.indexOf('Senha em conexão') !== -1);
  assert.ok(names.indexOf('Token JWT') !== -1);
  assert.ok(names.indexOf('Private Key') !== -1);
  assert.ok(names.indexOf('DATABASE_URL') !== -1);
  assert.strictEqual(scanner.PATTERNS.length, 7);
});

test('PATTERNS têm regex compilados', () => {
  scanner.PATTERNS.forEach(function(p) {
    assert.ok(p.regex instanceof RegExp, p.name + ' should have a RegExp');
  });
});

// ─── Tests: Detecção de padrões individuais ────────────────────────────

console.log('\n🔐 secrets-scanner.js — Pattern Detection\n');

test('AWS Access Key é detectado', () => {
  const content = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
  var matches = content.match(scanner.PATTERNS[0].regex);
  assert.ok(matches !== null, 'AWS key should match');
  assert.ok(matches.length >= 1, 'At least 1 match');
});

test('GitHub Token (ghs_ format) é detectado', () => {
  const content = 'token=ghs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  var matches = content.match(scanner.PATTERNS[1].regex);
  assert.ok(matches !== null, 'GitHub token ghs_ should match');
});

test('GitHub Token (ghp_ format) é detectado', () => {
  const content = 'token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  var matches = content.match(scanner.PATTERNS[1].regex);
  assert.ok(matches !== null, 'GitHub token ghp_ should match');
});

test('API Key genérica é detectada', () => {
  const content = 'api_key = "abc123def456ghi789jkl012mno345pqr"';
  var matches = content.match(scanner.PATTERNS[2].regex);
  assert.ok(matches !== null, 'API key should match');
});

test('Senha em conexão é detectada', () => {
  const content = 'password: "super_secret_123"';
  var matches = content.match(scanner.PATTERNS[3].regex);
  assert.ok(matches !== null, 'Password should match');
});

test('Token JWT é detectado', () => {
  const content = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqP0bL0R5G0o0Cj0a0b0c0d0e0f0g0h0i0j';
  var matches = content.match(scanner.PATTERNS[4].regex);
  assert.ok(matches !== null, 'JWT should match');
});

test('Private Key é detectado', () => {
  const content = '-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----';
  var matches = content.match(scanner.PATTERNS[5].regex);
  assert.ok(matches !== null, 'Private key header should match');
});

test('RSA Private Key é detectado', () => {
  const content = '-----BEGIN RSA PRIVATE KEY-----\nABC123\n-----END RSA PRIVATE KEY-----';
  var matches = content.match(scanner.PATTERNS[5].regex);
  assert.ok(matches !== null, 'RSA private key header should match');
});

test('DATABASE_URL é detectado (com aspas)', () => {
  const content = 'DATABASE_URL="postgres://user:password@localhost:5432/db"';
  var matches = content.match(scanner.PATTERNS[6].regex);
  assert.ok(matches !== null, 'DATABASE_URL should match');
});

test('DATABASE_URL é detectado (com aspas simples)', () => {
  const content = "DATABASE_URL='postgres://user:password@localhost:5432/db'";
  var matches = content.match(scanner.PATTERNS[6].regex);
  assert.ok(matches !== null, 'DATABASE_URL should match');
});

test('DATABASE_URL é detectado (com dois pontos)', () => {
  const content = 'DATABASE_URL: "postgres://user:password@localhost:5432/db"';
  var matches = content.match(scanner.PATTERNS[6].regex);
  assert.ok(matches !== null, 'DATABASE_URL should match');
});

// ─── Tests: scanDirectory e run ─────────────────────────────────────────

console.log('\n🔐 secrets-scanner.js — scanDirectory\n');

test('scanDirectory encontra secrets em arquivo', () => {
  try {
    var dir = createTempDir();
    // DATABASE_URL com aspas para o pattern funcionar
    createTempFile('.env', 'DATABASE_URL="postgres://admin:secret123@localhost:5432/test"');
    // api_key com 32+ alfanuméricos (sem traço) para match no pattern
    createTempFile('config.js', 'var api_key = "abcdefghijklmnopqrstuvwxyz123456";');
    createTempFile('README.md', '# Normal file with no secrets');

    var results = scanner.run(dir);
    assert.strictEqual(results.length >= 2, true, 'Should find at least 2 secrets');
  } finally {
    cleanupTempDir();
  }
});

test('scanDirectory ignora node_modules', () => {
  try {
    var dir = createTempDir();
    createTempFile('node_modules/some-lib/config.js', 'password: "should_not_be_found"');
    createTempFile('src/app.js', 'var x = 1;');

    var results = scanner.run(dir);
    // Não deve encontrar o secret em node_modules
    var nodeModResults = results.filter(function(r) {
      return r.file.indexOf('node_modules') !== -1;
    });
    assert.strictEqual(nodeModResults.length, 0, 'Should not scan node_modules');
  } finally {
    cleanupTempDir();
  }
});

test('scanDirectory ignora .git', () => {
  try {
    var dir = createTempDir();
    createTempFile('.git/config', 'password: "secret_git"');
    createTempFile('file.txt', 'hello');

    var results = scanner.run(dir);
    var gitResults = results.filter(function(r) {
      return r.file.indexOf('.git') !== -1;
    });
    assert.strictEqual(gitResults.length, 0, 'Should not scan .git');
  } finally {
    cleanupTempDir();
  }
});

test('run() retorna array vazio para diretório limpo', () => {
  try {
    var dir = createTempDir();
    createTempFile('clean.js', 'var x = 1; console.log(x);');
    createTempFile('style.css', 'body { color: red; }');

    var results = scanner.run(dir);
    assert.strictEqual(results.length, 0);
  } finally {
    cleanupTempDir();
  }
});

test('run() com subdiretórios escaneia recursivamente', () => {
  try {
    var dir = createTempDir();
    createTempFile('src/deep/config.js', 'api_key = "abcdefghijklmnopqrstuvwxyz123456";');
    createTempFile('src/utils/helper.js', 'var token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";');

    var results = scanner.run(dir);
    assert.ok(results.length >= 2, 'Should find secrets in subdirectories');
  } finally {
    cleanupTempDir();
  }
});

test('run() lida com diretório vazio', () => {
  try {
    var dir = createTempDir();
    var results = scanner.run(dir);
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  } finally {
    cleanupTempDir();
  }
});

test('run() lida com diretório que não existe', () => {
  var results = scanner.run('c:\\nonexistent_dir_xyz123');
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 0);
});

// ─── Tests: CLI coverage (require.main === module) ──────────────────────

console.log('\n🔐 secrets-scanner.js — CLI coverage\n');

test('Módulo exporta run e PATTERNS', () => {
  assert.strictEqual(typeof scanner.run, 'function');
  assert.ok(Array.isArray(scanner.PATTERNS));
  assert.strictEqual(scanner.PATTERNS.length, 7);
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
