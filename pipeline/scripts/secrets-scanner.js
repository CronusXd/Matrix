// HARNESS Secrets Scanner v1.0
// Detecta tokens, senhas e chaves em texto claro no código
// Uso: node secrets-scanner.js [diretório]

var fs = require('fs');
var path = require('path');

var PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub Token', regex: /gh[ps]_[0-9a-zA-Z]{36}/g },
  { name: 'API Key genérica', regex: /api[_-]?key['"]?\s*[:=]\s*['"][0-9a-zA-Z]{32,}/gi },
  { name: 'Senha em conexão', regex: /password\s*[:=]\s*['"][^'"]+['"]/gi },
  { name: 'Token JWT', regex: /eyJ[0-9a-zA-Z_-]+\.[0-9a-zA-Z_-]+\.[0-9a-zA-Z_-]+/g },
  { name: 'Private Key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
  { name: 'DATABASE_URL', regex: /DATABASE_URL\s*[:=]\s*['"].*\/\/.*:.*@/gi }
];

var EXCLUDE_DIRS = ['node_modules', '.git', '__pycache__', 'build', 'dist'];

function scanDir(dir, results) {
  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var e of entries) {
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(e.name)) scanDir(path.join(dir, e.name), results);
      } else if (e.isFile()) {
        try {
          var content = fs.readFileSync(path.join(dir, e.name), 'utf8');
          PATTERNS.forEach(function(p) {
            var matches = content.match(p.regex);
            if (matches) {
              results.push({ file: path.join(dir, e.name), pattern: p.name, count: matches.length });
            }
          });
        } catch(err) { /* binary file */ }
      }
    }
  } catch(err) {}
}

function run(dir) {
  var results = [];
  scanDir(dir || process.cwd(), results);
  return results;
}

// CLI
if (require.main === module) {
  var dir = process.argv[2] || process.cwd();
  if (process.argv.includes('--help')) {
    console.log('HARNESS Secrets Scanner v1.0');
    console.log('Uso: node secrets-scanner.js [diretório]');
    console.log('Escaneia arquivos por tokens, senhas e chaves em texto claro.');
    process.exit(0);
  }
  var results = run(dir);
  if (results.length === 0) {
    console.log('✅ Nenhum secret encontrado em: ' + dir);
  } else {
    console.log('⚠️  ' + results.length + ' potenciais secrets encontrados:');
    results.forEach(function(r) {
      console.log('  [' + r.pattern + '] ' + r.file + ' (' + r.count + ' ocorrências)');
    });
  }
}

module.exports = { run, PATTERNS };
