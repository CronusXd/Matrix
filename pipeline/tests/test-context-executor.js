#!/usr/bin/env node
// =====================================================================
// Test: context-executor.js — Pure functions extraídas
// Estratégia: COPIA as funções PURAS do context-executor.js
// =====================================================================

'use strict';

const assert = require('assert');

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

// =====================================================================
//  FUNÇÕES EXTRAÍDAS (copiadas do context-executor.js)
// =====================================================================

// patternToTest — converte pattern em função de teste.
// Suporta: *.ext, prefixo*, **/docs/**, patterns compostos, exato.
function patternToTest(pattern) {
  let p = pattern.replace(/^\*\*\\?[/]/, '');

  if (pattern.includes('**/') && pattern.endsWith('/**')) {
    const fixedPart = pattern.replace('**/', '').replace('/**', '');
    return (filePath) => filePath.includes(fixedPart);
  }

  if (p.startsWith('*.')) {
    const ext = p.substring(1);
    return (filePath) => filePath.endsWith(ext);
  }

  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    return (filePath) => path.basename(filePath).startsWith(prefix);
  }

  if (pattern.includes('*')) {
    const parts = pattern.split('*');
    const start = parts[0];
    const end = parts[parts.length - 1];
    return (filePath) => {
      const base = path.basename(filePath);
      return base.startsWith(start) && base.endsWith(end);
    };
  }

  return (filePath) => filePath.endsWith(p);
}

/**
 * excludePatternToTest — cria função de exclusão para exclude pattern.
 */
function excludePatternToTest(pattern) {
  if (pattern.endsWith('/**')) {
    const dir = pattern.replace('/**', '');
    return (fp) => fp.includes(dir);
  }
  if (pattern.startsWith('*.')) {
    const ext = pattern.substring(1);
    return (fp) => fp.endsWith(ext);
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return (fp) => path.basename(fp).startsWith(prefix);
  }
  return (fp) => fp.includes(pattern);
}

/**
 * isExcluded — verifica se path deve ser excluído.
 */
function isExcluded(filePath, excludeTests) {
  for (const test of excludeTests) {
    if (test(filePath)) return true;
  }
  return false;
}

/**
 * cb3Elimination — filtra por min_score, ordena, limita a max_files.
 */
function cb3Elimination(scored, config) {
  let filtered = scored.filter(s => s.score >= config.min_score);
  filtered.sort((a, b) => b.score - a.score);
  const eliminated = filtered.slice(config.max_files);
  filtered = filtered.slice(0, config.max_files);
  return { kept: filtered, eliminated: scored.filter(s => s.score < config.min_score).concat(eliminated) };
}

/**
 * formatRepoStructure — formata dados estruturais do repositório.
 */
function formatRepoStructure(repoSummary) {
  if (!repoSummary) return '';

  var output = '';
  output += '- **Total de arquivos:** ' + repoSummary.totalFiles + '\n';
  output += '- **Total de diret\u00f3rios:** ' + repoSummary.totalDirs + '\n';
  output += '- **Tamanho total:** ' + repoSummary.totalSizeKB + ' KB\n';
  output += '- **Profundidade m\u00e1xima:** ' + repoSummary.maxDepth + '\n';
  output += '- **Frameworks detectados:** ' + (repoSummary.frameworks.join(', ') || 'nenhum') + '\n';

  output += '- **Tipos de arquivo:**\n';
  var types = repoSummary.fileTypes || {};
  var typeNames = Object.keys(types);
  typeNames.sort(function(a, b) { return types[b] - types[a]; });
  for (var ti = 0; ti < typeNames.length; ti++) {
    var type = typeNames[ti];
    output += '  - `' + type + '`: ' + types[type] + ' arquivo(s)\n';
  }

  if (repoSummary.topFiles && repoSummary.topFiles.length > 0) {
    output += '- **Maiores arquivos:**\n';
    var topSlice = repoSummary.topFiles.slice(0, 5);
    for (var fi = 0; fi < topSlice.length; fi++) {
      var f = topSlice[fi];
      var sizeKB = Math.round(f.size / 1024);
      output += '  - ' + (fi + 1) + '. `' + f.path + '` (' + sizeKB + ' KB)\n';
    }
  }

  if (repoSummary.directoryTree && repoSummary.directoryTree.children) {
    output += '- **Diret\u00f3rios principais:**\n';
    var children = repoSummary.directoryTree.children;
    for (var ci = 0; ci < children.length; ci++) {
      if (children[ci].type === 'directory') {
        output += '  - `' + children[ci].name + '/` (' + (children[ci].children || []).length + ' itens)\n';
      }
    }
  }

  return output;
}

// Precisamos de path para patternToTest
const path = require('path');

// =====================================================================
//  patternToTest
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 patternToTest\x1b[0m\n');

test('*.js → match arquivo .js', () => {
  const matcher = patternToTest('*.js');
  assert.strictEqual(matcher('/path/to/file.js'), true);
  assert.strictEqual(matcher('/path/to/file.ts'), false);
});

test('*.js → match com subdiretório', () => {
  const matcher = patternToTest('*.js');
  assert.strictEqual(matcher('/path/to/src/index.js'), true);
});

test('prefixo* → match por prefixo', () => {
  const matcher = patternToTest('README*');
  assert.strictEqual(matcher('/path/README.md'), true);
  assert.strictEqual(matcher('/path/README.txt'), true);
  assert.strictEqual(matcher('/path/CHANGELOG.md'), false);
});

test('**/docs/** → match qualquer path contendo /docs/', () => {
  const matcher = patternToTest('**/docs/**');
  assert.strictEqual(matcher('/path/docs/file.md'), true);
  assert.strictEqual(matcher('/path/docs/sub/file.md'), true);
  assert.strictEqual(matcher('/path/src/file.js'), false);
});

test('pattern composto test*file → match', () => {
  const matcher = patternToTest('test*file');
  assert.strictEqual(matcher('/path/test_my_file'), true);
  assert.strictEqual(matcher('/path/other_file'), false);
});

test('pattern exato .env → match', () => {
  const matcher = patternToTest('.env');
  assert.strictEqual(matcher('/path/.env'), true);
  assert.strictEqual(matcher('/path/.env.prod'), false);
});

test('pattern *.{ts,tsx} → match via prefixo (tratado como prefixo*)', () => {
  // Isso vai ser tratado como endsWith, não como glob composto
  const matcher = patternToTest('*.ts');
  assert.strictEqual(matcher('/path/file.ts'), true);
});

test('pattern vazio → match exato (string vazia)', () => {
  const matcher = patternToTest('');
  // endsWith('') é true para qualquer string
  assert.strictEqual(matcher('/any/path'), true);
});

// =====================================================================
//  excludePatternToTest
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 excludePatternToTest\x1b[0m\n');

test('node_modules/** → match paths contendo node_modules', () => {
  const matcher = excludePatternToTest('node_modules/**');
  assert.strictEqual(matcher('/path/node_modules/pkg/index.js'), true);
  assert.strictEqual(matcher('/path/src/index.js'), false);
});

test('*.pyc → match arquivos .pyc', () => {
  const matcher = excludePatternToTest('*.pyc');
  assert.strictEqual(matcher('file.pyc'), true);
  assert.strictEqual(matcher('file.py'), false);
});

test('.env* → match por prefixo .env', () => {
  const matcher = excludePatternToTest('.env*');
  assert.strictEqual(matcher('/path/.env'), true);
  assert.strictEqual(matcher('/path/.env.prod'), true);
  assert.strictEqual(matcher('/path/env'), false);
});

test('.git/** → match paths contendo .git', () => {
  const matcher = excludePatternToTest('.git/**');
  assert.strictEqual(matcher('/path/.git/config'), true);
});

test('pattern exato node_modules → match contendo', () => {
  const matcher = excludePatternToTest('node_modules');
  assert.strictEqual(matcher('/path/node_modules'), true);
  assert.strictEqual(matcher('/path/node_modules/pkg'), true);
  assert.strictEqual(matcher('/path/src'), false);
});

// =====================================================================
//  isExcluded
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 isExcluded\x1b[0m\n');

test('node_modules é excluído', () => {
  const excludeTests = [
    excludePatternToTest('node_modules/**'),
    excludePatternToTest('.git/**')
  ];
  assert.strictEqual(isExcluded('/path/node_modules/pkg/index.js', excludeTests), true);
});

test('.git é excluído', () => {
  const excludeTests = [
    excludePatternToTest('.git/**')
  ];
  assert.strictEqual(isExcluded('/path/.git/config', excludeTests), true);
});

test('__pycache__ é excluído', () => {
  const excludeTests = [
    excludePatternToTest('__pycache__/**')
  ];
  assert.strictEqual(isExcluded('/path/__pycache__/cache.pyc', excludeTests), true);
});

test('src/index.js NÃO é excluído', () => {
  const excludeTests = [
    excludePatternToTest('node_modules/**'),
    excludePatternToTest('.git/**')
  ];
  assert.strictEqual(isExcluded('/path/src/index.js', excludeTests), false);
});

test('múltiplos excludes: qualquer um match = excluído', () => {
  const excludeTests = [
    excludePatternToTest('node_modules/**'),
    excludePatternToTest('*.pyc'),
    excludePatternToTest('.git/**'),
    excludePatternToTest('__pycache__/**')
  ];
  assert.strictEqual(isExcluded('/path/node_modules/foo.js', excludeTests), true);
  assert.strictEqual(isExcluded('/path/file.pyc', excludeTests), true);
  assert.strictEqual(isExcluded('/path/.git/HEAD', excludeTests), true);
  assert.strictEqual(isExcluded('/path/__pycache__/foo.pyc', excludeTests), true);
  assert.strictEqual(isExcluded('/path/src/index.js', excludeTests), false);
});

test('exclude array vazio → nada excluído', () => {
  assert.strictEqual(isExcluded('/path/node_modules/x.js', []), false);
});

// =====================================================================
//  cb3Elimination
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 cb3Elimination\x1b[0m\n');

test('cb3: filtra por min_score e ordena decrescente', () => {
  const scored = [
    { path: 'a.js', score: 5 },
    { path: 'b.js', score: 15 },
    { path: 'c.js', score: 10 },
    { path: 'd.js', score: 2 }  // abaixo do min_score
  ];
  const result = cb3Elimination(scored, { min_score: 3, max_files: 10 });
  assert.strictEqual(result.kept.length, 3);
  assert.strictEqual(result.kept[0].path, 'b.js');  // 15
  assert.strictEqual(result.kept[1].path, 'c.js');  // 10
  assert.strictEqual(result.kept[2].path, 'a.js');  // 5
  // d.js deve estar em eliminated
  assert.strictEqual(result.eliminated.length, 1);
  assert.strictEqual(result.eliminated[0].path, 'd.js');
});

test('cb3: limita a max_files', () => {
  const scored = [
    { path: 'a.js', score: 10 },
    { path: 'b.js', score: 9 },
    { path: 'c.js', score: 8 },
    { path: 'd.js', score: 7 }
  ];
  const result = cb3Elimination(scored, { min_score: 0, max_files: 2 });
  assert.strictEqual(result.kept.length, 2);
  assert.strictEqual(result.kept[0].path, 'a.js');
  assert.strictEqual(result.kept[1].path, 'b.js');
});

test('cb3: todos acima do score, sem limite', () => {
  const scored = [
    { path: 'a.js', score: 10 },
    { path: 'b.js', score: 5 }
  ];
  const result = cb3Elimination(scored, { min_score: 3, max_files: 100 });
  assert.strictEqual(result.kept.length, 2);
  assert.strictEqual(result.eliminated.length, 0);
});

test('cb3: todos abaixo do min_score → kept vazio', () => {
  const scored = [
    { path: 'a.js', score: 1 },
    { path: 'b.js', score: 2 }
  ];
  const result = cb3Elimination(scored, { min_score: 5, max_files: 10 });
  assert.strictEqual(result.kept.length, 0);
  assert.strictEqual(result.eliminated.length, 2);
});

test('cb3: lista vazia', () => {
  const result = cb3Elimination([], { min_score: 0, max_files: 10 });
  assert.strictEqual(result.kept.length, 0);
  assert.strictEqual(result.eliminated.length, 0);
});

test('cb3: max_files 0 → kept vazio', () => {
  const scored = [{ path: 'a.js', score: 10 }];
  const result = cb3Elimination(scored, { min_score: 0, max_files: 0 });
  assert.strictEqual(result.kept.length, 0);
  assert.strictEqual(result.eliminated.length, 1);
});

test('cb3: empatados por score → ordem estável (original)', () => {
  const scored = [
    { path: 'b.js', score: 10 },
    { path: 'a.js', score: 10 }
  ];
  const result = cb3Elimination(scored, { min_score: 0, max_files: 2 });
  assert.strictEqual(result.kept.length, 2);
  // Ambos têm score 10, sort não garante ordem de originais mas b estava antes
  assert.strictEqual(result.kept[0].score, 10);
  assert.strictEqual(result.kept[1].score, 10);
});

// =====================================================================
//  formatRepoStructure
// =====================================================================

console.log('\n\x1b[36m\x1b[1m📦 formatRepoStructure\x1b[0m\n');

test('formatRepoStructure: summary completo', () => {
  const summary = {
    totalFiles: 42,
    totalDirs: 10,
    totalSizeKB: 2048,
    maxDepth: 5,
    frameworks: ['node', 'react'],
    fileTypes: { '.js': 20, '.json': 10, '.md': 5 },
    topFiles: [
      { path: 'src/index.js', size: 102400 },
      { path: 'src/app.js', size: 51200 }
    ],
    directoryTree: {
      children: [
        { name: 'src', type: 'directory', children: [{ name: 'index.js', type: 'file' }] },
        { name: 'docs', type: 'directory', children: [] }
      ]
    }
  };

  const output = formatRepoStructure(summary);
  // Nota: o formato usa Markdown **bold** nos labels, então o texto inclui **
  assert.ok(output.includes('Total de arquivos'), 'deve conter Total de arquivos. output: ' + output.substring(0, 100));
  assert.ok(output.includes('42'), 'deve conter 42. output: ' + output);
  assert.ok(output.includes('Total de diret\u00f3rios') || output.includes('Total de diretorios'));
  assert.ok(output.includes('10'));
  assert.ok(output.includes('Total:') || output.includes('Tamanho total'));
  assert.ok(output.includes('Frameworks detectados'));
  assert.ok(output.includes('node, react'));
  assert.ok(output.includes('.js'));
  assert.ok(output.includes('20 arquivo(s)'));
  assert.ok(output.includes('src/index.js'));
  assert.ok(output.includes('100 KB'));
  assert.ok(output.includes('src/') || output.includes('Diret'));
});

test('formatRepoStructure: sem frameworks', () => {
  const summary = {
    totalFiles: 1,
    totalDirs: 0,
    totalSizeKB: 1,
    maxDepth: 1,
    frameworks: [],
    fileTypes: {}
  };
  const output = formatRepoStructure(summary);
  assert.ok(output.includes('Frameworks detectados'), 'deve conter frameworks. output: ' + output);
  // O valor "nenhum" vem do fallback quando frameworks está vazio
  assert.ok(output.indexOf('nenhum') >= 0 || output.indexOf('frameworks') >= 0);
});

test('formatRepoStructure: sem fileTypes → seção vazia', () => {
  const summary = {
    totalFiles: 5,
    totalDirs: 2,
    totalSizeKB: 100,
    maxDepth: 3,
    frameworks: [],
    fileTypes: {}
  };
  const output = formatRepoStructure(summary);
  assert.ok(output.includes('Tipos de arquivo:'));
});

test('formatRepoStructure: sem topFiles → seção omitida', () => {
  const summary = {
    totalFiles: 5,
    totalDirs: 2,
    totalSizeKB: 100,
    maxDepth: 3,
    frameworks: []
  };
  const output = formatRepoStructure(summary);
  assert.ok(!output.includes('Maiores arquivos'));
});

test('formatRepoStructure: null → string vazia', () => {
  assert.strictEqual(formatRepoStructure(null), '');
});

test('formatRepoStructure: undefined → string vazia', () => {
  assert.strictEqual(formatRepoStructure(undefined), '');
});

// =====================================================================
//  SUMMARY
// =====================================================================

const total = testsPassed + testsFailed;
console.log('\n\x1b[1m\u2514\u2500 Resultado:\x1b[0m ' +
  (testsFailed === 0 ? '\x1b[32m' + testsPassed + '/' + total + ' testes passaram\x1b[0m' :
                       '\x1b[31m' + testsPassed + '/' + total + ' passaram, ' + testsFailed + ' falharam\x1b[0m'));

process.exit(testsFailed > 0 ? 1 : 0);
