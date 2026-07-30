/**
 * Matrix File Utils v1.0 — Shared Utility
 * Consolida a lógica de file walking e glob matching que estava
 * duplicada em rag-index.js, context-executor.js e vector-store.js.
 *
 * Zero dependências npm.
 * CommonJS.
 */

const fs = require('fs');
const path = require('path');

/**
 * Converte um padrão glob simples para uma função de teste.
 * Suporta: **/*.ext, *.ext, prefixo*, *sufixo, docs/** , paths exatos.
 *
 * @param {string} pattern — Padrão glob (ex: "**/*.js", "*.md", "docs/**")
 * @returns {function(string): boolean}
 */
function globToTest(pattern) {
  // Normaliza separadores
  const p = pattern.replace(/\\/g, '/');

  // **/*.ext → testa extensão em qualquer profundidade
  if (p.startsWith('**/')) {
    const suffix = p.substring(3); // "*.js" ou "dir/**"
    if (suffix.endsWith('/**')) {
      // "**/docs/**" → caminho contém "/docs/"
      const fixedPart = suffix.replace('/**', '');
      return (filePath) => filePath.replace(/\\/g, '/').includes('/' + fixedPart + '/');
    }
    if (suffix.startsWith('*.')) {
      const ext = suffix.substring(1);
      return (filePath) => filePath.endsWith(ext);
    }
    return (filePath) => filePath.replace(/\\/g, '/').includes('/' + suffix);
  }

  // *.ext → testa extensão no nome do arquivo
  if (p.startsWith('*.')) {
    const ext = p.substring(1);
    return (filePath) => filePath.endsWith(ext);
  }

  // prefixo* → testa início do nome
  if (p.endsWith('*') && !p.endsWith('/**')) {
    const prefix = p.slice(0, -1);
    return (filePath) => path.basename(filePath).startsWith(prefix);
  }

  // dir/** → testa se caminho contém dir/
  if (p.endsWith('/**')) {
    const dir = p.replace('/**', '');
    return (filePath) => filePath.replace(/\\/g, '/').includes('/' + dir + '/');
  }

  // Path exato ou com wildcards internos
  if (p.includes('*')) {
    const parts = p.split('*');
    const start = parts[0];
    const end = parts[parts.length - 1];
    return (filePath) => {
      const base = path.basename(filePath);
      return base.startsWith(start) && base.endsWith(end);
    };
  }

  // Exato (termina com o pattern)
  return (filePath) => filePath.replace(/\\/g, '/').endsWith(p);
}

/**
 * Walk recursivo do diretório com filtros de inclusão e exclusão.
 * Consolida a lógica de rag-index.js e context-executor.js.
 *
 * @param {string} rootDir — Diretório raiz
 * @param {Object} [options] — Opções
 * @param {string[]} [options.include] — Padrões de inclusão (glob)
 * @param {string[]} [options.exclude] — Padrões de exclusão (glob)
 * @param {string[]} [options.includeExts] — Extensões para incluir (ex: ['.js', '.md'])
 * @param {number} [options.maxFiles] — Máximo de arquivos (default: Infinity)
 * @returns {string[]} Lista de caminhos absolutos
 */
function walkDir(rootDir, options) {
  options = options || {};
  const includePatterns = options.include || [];
  const excludePatterns = options.exclude || [];
  const includeExts = options.includeExts || [];
  const maxFiles = options.maxFiles || Infinity;

  // Pré-compila funções de teste
  const includeTests = includePatterns.map(globToTest);
  const excludeTests = excludePatterns.map(globToTest);

  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip sem permissão
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      const fullPath = path.join(dir, entry.name);
      const normalized = fullPath.replace(/\\/g, '/');

      // Verifica exclusão primeiro
      let excluded = false;
      for (const test of excludeTests) {
        if (test(normalized)) { excluded = true; break; }
      }
      if (excluded) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        // Filtro por extensão (mais rápido que glob)
        if (includeExts.length > 0) {
          const ext = path.extname(fullPath).toLowerCase();
          if (!includeExts.includes(ext)) continue;
        }

        // Filtro por padrões de inclusão
        if (includeTests.length > 0) {
          let matched = false;
          for (const test of includeTests) {
            if (test(normalized)) { matched = true; break; }
          }
          if (!matched) continue;
        }

        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Lê o conteúdo de um arquivo com fallback seguro.
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Lista diretórios no diretório raiz (apenas um nível).
 * @param {string} dirPath
 * @returns {string[]}
 */
function listDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

module.exports = { walkDir, globToTest, readFileSafe, listDirs };
