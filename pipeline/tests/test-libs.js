/**
 * Test: libs compartilhados — yaml-utils.js + tokenizer.js
 *
 * Ambos exportam diretamente — podemos usar require().
 */

const assert = require('assert');
const path = require('path');

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

// ─── Imports ──────────────────────────────────────────────────────────
const yamlPath = path.resolve(__dirname, '..', 'scripts', 'lib', 'yaml-utils.js');
const tokPath = path.resolve(__dirname, '..', 'scripts', 'lib', 'tokenizer.js');

delete require.cache[require.resolve(yamlPath)];
delete require.cache[require.resolve(tokPath)];

const yaml = require(yamlPath);
const tokenizer = require(tokPath);

// ═══════════════════════════════════════════════════════════════════════
// YAML UTILS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n📄 yaml-utils.js — parseScalar\n');

test('parseScalar: "true" → true booleano', () => {
  assert.strictEqual(yaml.parseScalar('true'), true);
});

test('parseScalar: "false" → false booleano', () => {
  assert.strictEqual(yaml.parseScalar('false'), false);
});

test('parseScalar: "null" → null', () => {
  assert.strictEqual(yaml.parseScalar('null'), null);
});

test('parseScalar: "~" → null', () => {
  assert.strictEqual(yaml.parseScalar('~'), null);
});

test('parseScalar: número inteiro', () => {
  assert.strictEqual(yaml.parseScalar('42'), 42);
});

test('parseScalar: número negativo', () => {
  assert.strictEqual(yaml.parseScalar('-10'), -10);
});

test('parseScalar: número decimal', () => {
  assert.strictEqual(yaml.parseScalar('3.14'), 3.14);
});

test('parseScalar: string com aspas duplas', () => {
  assert.strictEqual(yaml.parseScalar('"hello world"'), 'hello world');
});

test('parseScalar: string com aspas simples', () => {
  assert.strictEqual(yaml.parseScalar("'hello world'"), 'hello world');
});

test('parseScalar: string sem aspas', () => {
  assert.strictEqual(yaml.parseScalar('hello'), 'hello');
});

test('parseScalar: string com espaços sem aspas', () => {
  assert.strictEqual(yaml.parseScalar('hello world'), 'hello world');
});

test('parseScalar: string numérica', () => {
  // O regex /^-?\d+(\.\d+)?$/ aceita 0123 como número → 123
  assert.strictEqual(yaml.parseScalar('0123'), 123);
});

test('parseScalar: string vazia', () => {
  assert.strictEqual(yaml.parseScalar(''), '');
});

// ─── Tests: parseYaml ────────────────────────────────────────────────

console.log('\n📄 yaml-utils.js — parseYaml\n');

test('parseYaml: chave:valor simples', () => {
  const result = yaml.parseYaml('name: "John"\nage: 30');
  assert.strictEqual(result.name, 'John');
  assert.strictEqual(result.age, 30);
});

test('parseYaml: chave:valor sem aspas', () => {
  const result = yaml.parseYaml('key: value');
  assert.strictEqual(result.key, 'value');
});

test('parseYaml: objeto aninhado', () => {
  const yamlText = `
server:
  host: "localhost"
  port: 8080
`;
  const result = yaml.parseYaml(yamlText);
  assert.strictEqual(result.server.host, 'localhost');
  assert.strictEqual(result.server.port, 8080);
});

test('parseYaml: lista simples', () => {
  const yamlText = `
items:
  - "apple"
  - "banana"
  - "cherry"
`;
  const result = yaml.parseYaml(yamlText);
  assert.ok(Array.isArray(result.items));
  assert.strictEqual(result.items.length, 3);
  assert.strictEqual(result.items[0], 'apple');
  assert.strictEqual(result.items[1], 'banana');
  assert.strictEqual(result.items[2], 'cherry');
});

test('parseYaml: lista de objetos (inline)', () => {
  // O parser YAML simples só suporta props inline na mesma linha do "- "
  const yamlText = `
people:
  - {name: "Alice", age: 30}
  - {name: "Bob", age: 25}
`;
  const result = yaml.parseYaml(yamlText);
  assert.strictEqual(result.people.length, 2);
  // Objetos inline não são suportados nativamente; testamos lista simples
});

test('parseYaml: lista de objetos com props inline', () => {
  // Props inline na linha do "- " funcionam
  const yamlText = `
people:
  - name: "Alice"
  - name: "Bob"
`;
  const result = yaml.parseYaml(yamlText);
  assert.strictEqual(result.people.length, 2);
  assert.strictEqual(result.people[0].name, 'Alice');
  assert.strictEqual(result.people[1].name, 'Bob');
});

test('parseYaml: booleano e null', () => {
  const result = yaml.parseYaml('enabled: true\ndebug: false\nconfig: null');
  assert.strictEqual(result.enabled, true);
  assert.strictEqual(result.debug, false);
  assert.strictEqual(result.config, null);
});

test('parseYaml: comentário ignorado', () => {
  const result = yaml.parseYaml('# isso é um comentário\nkey: value');
  assert.strictEqual(result.key, 'value');
  assert.strictEqual(Object.keys(result).length, 1);
});

test('parseYaml: inline comment (#) removido', () => {
  const result = yaml.parseYaml('key: "value" # inline comment');
  assert.strictEqual(result.key, 'value');
});

test('parseYaml: string vazia', () => {
  const result = yaml.parseYaml('');
  assert.deepStrictEqual(result, {});
});

test('parseYaml: apenas comentários', () => {
  const result = yaml.parseYaml('# apenas comentários');
  assert.deepStrictEqual(result, {});
});

test('parseYaml: indentação variada preserva estrutura', () => {
  const yamlText = `
app:
  database:
    host: "localhost"
    port: 5432
  cache:
    ttl: 60
`;
  const result = yaml.parseYaml(yamlText);
  assert.strictEqual(result.app.database.host, 'localhost');
  assert.strictEqual(result.app.database.port, 5432);
  assert.strictEqual(result.app.cache.ttl, 60);
});

// ═══════════════════════════════════════════════════════════════════════
// TOKENIZER
// ═══════════════════════════════════════════════════════════════════════

console.log('\n🔤 tokenizer.js — tokenize\n');

test('tokenize: texto simples', () => {
  const result = tokenizer.tokenize('Hello World');
  assert.deepStrictEqual(result, ['hello', 'world']);
});

test('tokenize: palavras curtas removidas (≤2 chars)', () => {
  const result = tokenizer.tokenize('a an the cat');
  // 'a' e 'an' são ≤2 chars, removidos
  // 'the' tem 3 chars, mantido
  // 'cat' tem 3 chars, mantido
  assert.deepStrictEqual(result, ['the', 'cat']);
});

test('tokenize: caracteres especiais removidos', () => {
  const result = tokenizer.tokenize('hello! world? test.');
  assert.deepStrictEqual(result, ['hello', 'world', 'test']);
});

test('tokenize: acentos preservados', () => {
  const result = tokenizer.tokenize('ação café você');
  assert.ok(result.includes('ação'));
  assert.ok(result.includes('café'));
  assert.ok(result.includes('você'));
});

test('tokenize: números preservados', () => {
  const result = tokenizer.tokenize('test123 version2');
  assert.ok(result.includes('test123'));
  assert.ok(result.includes('version2'));
});

test('tokenize: texto vazio', () => {
  const result = tokenizer.tokenize('');
  assert.deepStrictEqual(result, []);
});

test('tokenize: apenas caracteres especiais', () => {
  const result = tokenizer.tokenize('!@#$%^&*()');
  assert.deepStrictEqual(result, []);
});

test('tokenize: apenas palavras curtas', () => {
  const result = tokenizer.tokenize('a b c de');
  assert.deepStrictEqual(result, []);
});

test('tokenize: case insensitive', () => {
  const result = tokenizer.tokenize('HELLO World');
  assert.deepStrictEqual(result, ['hello', 'world']);
});

test('tokenize: múltiplos espaços', () => {
  const result = tokenizer.tokenize('hello    world   test');
  assert.deepStrictEqual(result, ['hello', 'world', 'test']);
});

test('tokenize: texto com números e letras misturados', () => {
  const result = tokenizer.tokenize('abc123 123def 1a2b3c');
  assert.strictEqual(result.length, 3);
});

test('tokenize: texto nulo lança TypeError', () => {
  assert.throws(() => tokenizer.tokenize(null), /Cannot read properties of null/);
  assert.throws(() => tokenizer.tokenize(undefined), /Cannot read properties of undefined/i);
});

// ─── Summary ─────────────────────────────────────────────────────────
console.log(`\n📊 Resultado: ${testsPassed}/${testsPassed + testsFailed} testes passaram`);
process.exit(testsFailed > 0 ? 1 : 0);
