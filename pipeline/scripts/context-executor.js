#!/usr/bin/env node
/**
 * Matrix Context Builder Executor v1.0
 * Executa CB.1-CB.6 automaticamente: descobre, pontua, elimina, ordena, monta e entrega.
 *
 * Modo CLI:
 *   node context-executor.js "<palavras-chave>" [--json] [--root <path>]
 *   node context-executor.js --help
 *
 * Zero npm dependencies. CommonJS.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── CARREGAMENTO OPCIONAL DO REPO-UNDERSTANDING (NON-BLOCKING) ──────
let repoUnderstanding = null;
try {
  repoUnderstanding = require('./repo-understanding');
} catch (err) {
  log('repo-understanding não disponível (non-blocking)');
}

// ─── CARREGAMENTO DO CONTEXT-COMPRESSOR (OBRIGATÓRIO, NON-BLOCKING) ────
let contextCompressor = null;
try {
  contextCompressor = require('./context-compressor');
  log('context-compressor carregado (compressão semântica disponível)');
} catch (err) {
  log('╔══════════════════════════════════════════════════════════════════╗');
  log('║  WARNING: context-compressor NÃO disponível                    ║');
  log('║  A compressão semântica está desativada.                       ║');
  log('║                                                                ║');
  log('║  Para ativar: certifique-se de que o arquivo                   ║');
  log('║  pipeline/scripts/context-compressor.js existe e é válido.    ║');
  log('║  Ele é um módulo CommonJS sem dependências externas.          ║');
  log('║  O fallback de truncamento simples está sendo usado.          ║');
  log('╚══════════════════════════════════════════════════════════════════╝');
}

// ─── RESOLVE CAMINHOS ────────────────────────────────────────────────
const SCRIPTS_DIR = __dirname;
const PIPELINE_DIR = path.resolve(SCRIPTS_DIR, '..');
const CONFIG_PATH = path.resolve(PIPELINE_DIR, 'context-builder.yaml');

// ─── HELPERS ──────────────────────────────────────────────────────────

function log(...args) {
  console.error('[context-executor]', ...args);
}

function usage() {
  console.log(`
Matrix Context Builder Executor v1.0

Uso:
  node context-executor.js "<palavras-chave>"        ← executa CB.1-CB.6
  node context-executor.js "<palavras-chave>" --json ← saída JSON
  node context-executor.js --help                    ← esta ajuda

Opções:
  --root <path>  Diretório raiz para escanear (padrão: diretório de trabalho atual)
  --json         Saída em JSON em vez de template formatado
`);
  process.exit(0);
}

// ─── MINI GLOB (Windows-friendly, zero deps) ──────────────────────────

/**
 * Converte pattern tipo "star-star-slash-star.js" para teste de caminho.
 * Suporta: .ext, prefixo*, docs, patterns simples.
 */
function patternToTest(pattern) {
  // Remove **/ do inicio (vamos walk recursivamente anyway)
  let p = pattern.replace(/^\*\*\\?[/]/, '');

  // Se pattern começa com **/docs/** → match qualquer path contendo /docs/
  if (pattern.includes('**/') && pattern.endsWith('/**')) {
    const fixedPart = pattern.replace('**/', '').replace('/**', '');
    return (filePath) => filePath.includes(fixedPart);
  }

  // Se tem wildcard tipo *.ext
  if (p.startsWith('*.')) {
    const ext = p.substring(1);
    return (filePath) => filePath.endsWith(ext);
  }

  // Se tem wildcard tipo prefixo*
  if (p.endsWith('*')) {
    const prefix = p.slice(0, -1);
    return (filePath) => path.basename(filePath).startsWith(prefix);
  }

  // Se é pattern exato tipo README*
  if (pattern.includes('*')) {
    const parts = pattern.split('*');
    const start = parts[0];
    const end = parts[parts.length - 1];
    return (filePath) => {
      const base = path.basename(filePath);
      return base.startsWith(start) && base.endsWith(end);
    };
  }

  // Exato
  return (filePath) => filePath.endsWith(p);
}

/**
 * Verifica se path deve ser excluído baseado nos exclude_patterns.
 */
function isExcluded(filePath, excludeTests) {
  for (const test of excludeTests) {
    if (test(filePath)) return true;
  }
  return false;
}

/**
 * Cria função de teste para exclude pattern.
 */
function excludePatternToTest(pattern) {
  // node_modules/** → verifica se contém node_modules
  if (pattern.endsWith('/**')) {
    const dir = pattern.replace('/**', '');
    return (fp) => fp.includes(dir);
  }
  // *.pyc → termina com .pyc
  if (pattern.startsWith('*.')) {
    const ext = pattern.substring(1);
    return (fp) => fp.endsWith(ext);
  }
  // .env* → começa com .env
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return (fp) => path.basename(fp).startsWith(prefix);
  }
  // Exato
  return (fp) => fp.includes(pattern);
}

/**
 * Walk recursivo do diretório aplicando patterns de inclusão e exclusão.
 */
function walkDir(rootDir, includeTests, excludeTests) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip sem permissão
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Normaliza para forward-slash pra compatibilidade com patterns
      const normalized = fullPath.replace(/\\/g, '/');

      // Verifica exclusão primeiro (mais rápido)
      if (isExcluded(normalized, excludeTests)) continue;

      if (entry.isDirectory()) {
        // Pula .git, node_modules já excluídos pelo excludeTests
        walk(fullPath);
      } else if (entry.isFile()) {
        // Testa contra patterns de inclusão
        for (const test of includeTests) {
          if (test(normalized)) {
            results.push(normalized);
            break;
          }
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

// ─── YAML LOADER (usa yaml-utils.js do projeto) ───────────────────────

function loadConfig() {
  const yamlUtils = require('./lib/yaml-utils');
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = yamlUtils.parseYaml(raw);

  // Extrai seções
  const cb = parsed.context_builder || {};
  const discovery = cb.discovery || {};
  const scoring = cb.scoring || {};
  const limits = cb.limits || {};
  const cacheCfg = cb.cache || {};
  const output = cb.output || {};

  return {
    file_patterns: discovery.file_patterns || [],
    doc_patterns: discovery.doc_patterns || [],
    exclude_patterns: discovery.exclude_patterns || [],
    scoring_rules: scoring.rules || [],
    max_files: limits.max_files || 15,
    max_context_lines: limits.max_context_lines || 500,
    compression_strategy: limits.compression_strategy || 'smart',
    compression_max_lines: limits.compression_max_lines || 200,
    min_score: limits.min_score || 3,
    cache_enabled: cacheCfg.enabled !== false,
    cache_ttl: cacheCfg.ttl_seconds || 60,
    template: output.template || ''
  };
}

// ─── CB.1: DISCOVERY ──────────────────────────────────────────────────
function cb1Discovery(config, rootDir) {
  log('CB.1: Descobrindo arquivos...');

  const includeTests = config.file_patterns.map(patternToTest);
  const excludeTests = config.exclude_patterns.map(excludePatternToTest);

  const files = walkDir(rootDir, includeTests, excludeTests);

  // Também descobre docs (podem ter patterns diferentes)
  const docTests = config.doc_patterns.map(patternToTest);
  const docFiles = walkDir(rootDir, docTests, excludeTests);

  log(`  → ${files.length} arquivos encontrados`);
  log(`  → ${docFiles.length} documentos encontrados`);

  return { files, docFiles };
}

// ─── CB.2: SCORING ────────────────────────────────────────────────────
function cb2Scoring(files, docFiles, keywords, config, rootDir) {
  log('CB.2: Pontuando arquivos...');

  const keywordsLower = keywords.map(k => k.toLowerCase());
  const keywordTerms = keywordsLower;

  // Arquivos modificados nos últimos 5 commits (se git disponível)
  let recentFiles = new Set();
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>nul', {
      encoding: 'utf-8', timeout: 5000, cwd: rootDir
    }).trim();
    const diffOut = execSync('git diff --name-only HEAD~5 2>nul', {
      encoding: 'utf-8', timeout: 5000, cwd: gitRoot
    }).trim();
    if (diffOut) {
      recentFiles = new Set(diffOut.split('\n').map(l => {
        // Resolve caminho absoluto
        const absPath = path.resolve(gitRoot, l.trim());
        return absPath.replace(/\\/g, '/');
      }));
      log(`  → ${recentFiles.size} arquivos modificados recentemente`);
    }
  } catch {
    log('  → git não disponível, pulando recently_modified');
  }

  const scored = [];

  for (const filePath of files) {
    let score = 0;
    const reasons = [];
    const baseName = path.basename(filePath);
    const normalizedPath = filePath.replace(/\\/g, '/');

    // keyword_match (10pts)
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
      const contentLower = content.toLowerCase();
      for (const kw of keywordTerms) {
        if (contentLower.includes(kw)) {
          score += 10;
          reasons.push(`keyword_match (+10): contém "${kw}"`);
          break; // só uma vez por arquivo
        }
      }
    } catch {
      // skip files that can't be read
    }

    // file_name_match (8pts)
    const baseLower = baseName.toLowerCase();
    for (const kw of keywordTerms) {
      if (baseLower.includes(kw)) {
        score += 8;
        reasons.push(`file_name_match (+8): nome contém "${kw}"`);
        break;
      }
    }

    // recently_modified (5pts)
    if (recentFiles.has(normalizedPath)) {
      score += 5;
      reasons.push('recently_modified (+5): modificado nos últimos 5 commits');
    }

    // doc_match (4pts) — só se for doc
    if (docFiles.includes(normalizedPath)) {
      for (const kw of keywordTerms) {
        if (baseLower.includes(kw) || (content && content.toLowerCase().includes(kw))) {
          score += 4;
          reasons.push(`doc_match (+4): doc relevante para "${kw}"`);
          break;
        }
      }
    }

    // dependency (3pts) — checa se outros arquivos importam este
    if (content) {
      const importPatterns = [
        new RegExp(`require\\(['"]\\.\\.?/.*${path.basename(filePath, path.extname(filePath))}`, 'i'),
        new RegExp(`from ['"].*${path.basename(filePath, path.extname(filePath))}['"]`, 'i'),
        new RegExp(`import\\(['"].*${path.basename(filePath, path.extname(filePath))}`, 'i')
      ];
      for (const otherFile of files) {
        if (otherFile === filePath) continue;
        try {
          const otherContent = fs.readFileSync(otherFile, 'utf-8');
          for (const pat of importPatterns) {
            if (pat.test(otherContent)) {
              score += 3;
              reasons.push(`dependency (+3): importado por ${path.basename(otherFile)}`);
              break;
            }
          }
          if (reasons.some(r => r.startsWith('dependency'))) break;
        } catch {
          // skip
        }
      }
    }

    scored.push({ path: normalizedPath, score, reasons, baseName });
  }

  log(`  → ${scored.length} arquivos pontuados`);
  return scored;
}

// ─── CB.3: ELIMINATION ────────────────────────────────────────────────
function cb3Elimination(scored, config) {
  log('CB.3: Eliminando irrelevantes...');

  // Remove abaixo do min_score
  let filtered = scored.filter(s => s.score >= config.min_score);

  // Ordena por score decrescente
  filtered.sort((a, b) => b.score - a.score);

  // Limita a max_files
  const eliminated = filtered.slice(config.max_files);
  filtered = filtered.slice(0, config.max_files);

  log(`  → ${filtered.length} arquivos mantidos (score >= ${config.min_score}, max ${config.max_files})`);
  log(`  → ${eliminated.length} eliminados por limite`);

  return { kept: filtered, eliminated: scored.filter(s => s.score < config.min_score).concat(eliminated) };
}

// ─── HELPERS DE FORMATAÇÃO ────────────────────────────────────────────

/**
 * Formata os dados estruturais do repositório para o template de saída.
 */
function formatRepoStructure(repoSummary) {
  if (!repoSummary) return '';

  let output = `- **Total de arquivos:** ${repoSummary.totalFiles}\n`;
  output += `- **Total de diretórios:** ${repoSummary.totalDirs}\n`;
  output += `- **Tamanho total:** ${repoSummary.totalSizeKB} KB\n`;
  output += `- **Profundidade máxima:** ${repoSummary.maxDepth}\n`;
  output += `- **Frameworks detectados:** ${repoSummary.frameworks.join(', ') || 'nenhum'}\n`;

  output += `- **Tipos de arquivo:**\n`;
  const types = repoSummary.fileTypes || {};
  const sortedTypes = Object.keys(types).sort((a, b) => types[b] - types[a]);
  for (const type of sortedTypes) {
    output += `  - \`${type}\`: ${types[type]} arquivo(s)\n`;
  }

  // Top 5 maiores arquivos
  if (repoSummary.topFiles && repoSummary.topFiles.length > 0) {
    output += `- **Maiores arquivos:**\n`;
    repoSummary.topFiles.slice(0, 5).forEach((f, i) => {
      const sizeKB = Math.round(f.size / 1024);
      output += `  - ${i + 1}. \`${f.path}\` (${sizeKB} KB)\n`;
    });
  }

  // Estrutura de diretórios (primeiros 2 níveis)
  if (repoSummary.directoryTree && repoSummary.directoryTree.children) {
    output += `- **Diretórios principais:**\n`;
    const dirs = repoSummary.directoryTree.children.filter(c => c.type === 'directory');
    for (const dir of dirs) {
      const subCount = (dir.children || []).length;
      const fileCount = (dir.children || []).filter(c => c.type === 'file').length;
      output += `  - \`${dir.name}/\` (${dir.children.length} itens)\n`;
    }
  }

  return output;
}

// ─── CB.4-CB.6: SORT, ASSEMBLE, DELIVER ────────────────────────────────
function cb4to6(kept, eliminated, keywords, config, rootDir, repoSummary) {
  log('CB.4-CB.6: Ordenando, montando e entregando contexto...');

  // Já estão ordenados por score descrescente do CB.3

  // Template
  const template = config.template || `## 📋 Contexto Otimizado para @[especialista]

### Demanda
[descrição da demanda]

### Arquivos Relevantes (ordenados por importância)
1. [path] — [motivo da relevância]

### Estrutura do Projeto
[estrutura_do_projeto]

### Excluídos (irrelevantes)
- [path] — [motivo da exclusão]`;

  // Enriquece contexto com dados estruturais do projeto (se disponíveis)
  const estruturaFormatada = formatRepoStructure(repoSummary);

  // ─── COMPRESSÃO DE CONTEÚDO (CB.5) ──────────────────────────────────
  // Lê cada arquivo mantido e, se compressor disponível, comprime o conteúdo
  const strategy = config.compression_strategy || 'smart';
  const maxContentLines = config.compression_max_lines || 200;
  let totalCompressionStats = null;

  const filesWithContent = kept.map((f, i) => {
    const entry = {
      rank: i + 1,
      path: f.path,
      score: f.score,
      reasons: f.reasons
    };

    try {
      const rawContent = fs.readFileSync(f.path, 'utf-8');
      entry.original_lines = rawContent.split('\n').length;
      entry.original_chars = rawContent.length;

      if (contextCompressor) {
        // Compressão semântica com estratégia configurada
        const compressed = contextCompressor.compressContent(
          rawContent,
          maxContentLines,
          strategy,
          keywords
        );
        entry.compressed_content = compressed;
        entry.compressed_lines = compressed.split('\n').length;

        // Estatísticas de compressão para este arquivo
        entry.compression = contextCompressor.getCompressionRatio(rawContent, compressed);
      } else {
        // Fallback: truncamento simples
        const lines = rawContent.split('\n');
        const truncated = lines.slice(0, maxContentLines);
        entry.compressed_content = truncated.join('\n') +
          (lines.length > maxContentLines
            ? `\n// ... [truncado: ${lines.length - maxContentLines} linhas removidas]`
            : '');
        entry.compressed_lines = truncated.length;
      }
    } catch (err) {
      log(`  → erro ao ler/comprimir ${f.path}: ${err.message}`);
      entry.compressed_content = `// [erro ao ler arquivo: ${err.message}]`;
      entry.compressed_lines = 1;
      entry.original_lines = 0;
      entry.original_chars = 0;
    }

    return entry;
  });

  // Estatísticas globais de compressão
  if (contextCompressor) {
    const totalOriginal = filesWithContent.reduce((sum, f) => sum + (f.original_chars || 0), 0);
    const totalCompressed = filesWithContent.reduce((sum, f) => sum + (f.compressed_content ? f.compressed_content.length : 0), 0);
    totalCompressionStats = contextCompressor.getCompressionRatio(
      'x'.repeat(totalOriginal),
      'x'.repeat(totalCompressed)
    );
    totalCompressionStats.total_files = filesWithContent.length;
  }

  // Monta contexto estruturado
  const context = {
    metadata: {
      generated_at: new Date().toISOString(),
      keywords: keywords,
      root_dir: rootDir,
      total_scored: kept.length + eliminated.length,
      kept: kept.length,
      eliminated: eliminated.length,
      compression: {
        strategy: strategy,
        max_content_lines: maxContentLines,
        compressor_available: !!contextCompressor,
        stats: totalCompressionStats || null
      }
    },
    files: filesWithContent,
    excluded: eliminated.map(f => ({
      path: f.path,
      score: f.score,
      reason: f.score < 3 ? 'score abaixo do mínimo (3)' : 'excedeu limite máximo de arquivos'
    }))
  };

  // Adiciona seção estrutural se disponível
  if (repoSummary) {
    context.project_structure = {
      totalFiles: repoSummary.totalFiles,
      totalDirs: repoSummary.totalDirs,
      totalSizeKB: repoSummary.totalSizeKB,
      maxDepth: repoSummary.maxDepth,
      frameworks: repoSummary.frameworks,
      fileTypes: repoSummary.fileTypes,
      topFiles: repoSummary.topFiles,
      directoryTree: repoSummary.directoryTree
    };
  }

  // Monta saída formatada
  let formatted = template;

  // Substitui placeholders
  const filesSection = filesWithContent.map(f =>
    `${f.rank}. ${f.path} — ${f.reasons.join('; ') || 'relevante'}` +
    (f.compression ? ` [compressão: ${f.compression.savedPercent}]` : '')
  ).join('\n');

  const excludedSection = context.excluded.map(f =>
    `- ${f.path} — ${f.reason}`
  ).join('\n');

  // Conteúdo comprimido (opcional, adicionado após a lista de arquivos)
  let contentSection = '';
  if (filesWithContent.some(f => f.compressed_content)) {
    contentSection = '\n\n### Conteúdo Comprimido dos Arquivos\n\n';
    for (const f of filesWithContent) {
      contentSection += `**${f.rank}. \`${f.path}\`**`;
      if (f.compression) {
        contentSection += ` _(${f.compression.compressedLines}/${f.compression.originalLines} linhas, ${f.compression.savedPercent} economizado)_`;
      }
      contentSection += '\n```\n' + f.compressed_content + '\n```\n\n';
    }
  }

  // Estatísticas globais
  let statsSection = '';
  if (totalCompressionStats) {
    statsSection = `\n### Estatísticas de Compressão\n` +
      `- Estratégia: **${strategy}**\n` +
      `- Total economizado: **${totalCompressionStats.savedPercent}** ` +
      `(${totalCompressionStats.compressedChars}/${totalCompressionStats.originalChars} caracteres)\n`;
  }

  formatted = formatted
    .replace('[descrição da demanda]', keywords.join(', '))
    .replace('[especialista]', 'especialista')
    .replace('1. [path] — [motivo da relevância]', filesSection || '(nenhum arquivo relevante encontrado)')
    .replace('- [path] — [motivo da exclusão]', excludedSection || '(nenhum excluído)')
    .replace('[estrutura_do_projeto]', estruturaFormatada || '');

  // Adiciona seções extras (conteúdo comprimido + estatísticas)
  formatted += contentSection + statsSection;

  // Remove placeholders não substituídos
  formatted = formatted.replace(/\[.*?\]/g, '');

  return { context, formatted };
}

// ─── MAIN ─────────────────────────────────────────────────────────────
function main() {
  // Parse CLI args
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  let keywords = [];
  let outputJson = false;
  let rootDir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      outputJson = true;
    } else if (arg === '--root' && i + 1 < args.length) {
      rootDir = path.resolve(args[++i]);
    } else if (!arg.startsWith('--')) {
      keywords = arg.split(/[,\s]+/).filter(Boolean);
    }
  }

  if (keywords.length === 0) {
    log('ERRO: Nenhuma palavra-chave fornecida.');
    process.exit(1);
  }

  log(`Palavras-chave: ${keywords.join(', ')}`);
  log(`Diretório raiz: ${rootDir}`);

  if (!fs.existsSync(rootDir)) {
    log(`ERRO: Diretório raiz não encontrado: ${rootDir}`);
    process.exit(1);
  }

  // ─── CARREGA CONFIG ────────────────────────────────────────────────
  let config;
  try {
    config = loadConfig();
    log('Config carregada de context-builder.yaml');
  } catch (err) {
    log(`ERRO ao carregar config: ${err.message}`);
    process.exit(1);
  }

  // ─── CACHE CHECK ───────────────────────────────────────────────────
  if (config.cache_enabled) {
    try {
      /** @type {{ checkCache: Function, saveCache: Function }} */
      const cacheModule = require('./context-cache');
      const cached = cacheModule.checkCache(keywords);
      if (cached) {
        log('Cache HIT — retornando contexto cacheado');
        if (outputJson) {
          console.log(JSON.stringify(cached, null, 2));
        } else {
          console.log(cached.formatted || JSON.stringify(cached, null, 2));
        }
        return;
      }
      log('Cache MISS — executando CB.1-CB.6');
    } catch (err) {
      log(`Cache check falhou (non-blocking): ${err.message}`);
    }
  }

  // ─── CB.1: DISCOVERY ───────────────────────────────────────────────
  let discoveryResult;
  try {
    discoveryResult = cb1Discovery(config, rootDir);
  } catch (err) {
    log(`ERRO em CB.1: ${err.message}`);
    process.exit(1);
  }

  // ─── CB.2: SCORING ─────────────────────────────────────────────────
  let scored;
  try {
    scored = cb2Scoring(
      discoveryResult.files,
      discoveryResult.docFiles,
      keywords,
      config,
      rootDir
    );
  } catch (err) {
    log(`ERRO em CB.2: ${err.message}`);
    process.exit(1);
  }

  // ─── CB.3: ELIMINATION ─────────────────────────────────────────────
  let kept, eliminated;
  try {
    const result = cb3Elimination(scored, config);
    kept = result.kept;
    eliminated = result.eliminated;
  } catch (err) {
    log(`ERRO em CB.3: ${err.message}`);
    process.exit(1);
  }

  // ─── ANÁLISE ESTRUTURAL DO PROJETO (NON-BLOCKING) ──────────────────
  let repoSummary = null;
  if (repoUnderstanding && typeof repoUnderstanding.getProjectSummary === 'function') {
    try {
      log('Obtendo sumário estrutural do repositório...');
      repoSummary = repoUnderstanding.getProjectSummary(rootDir);
      log(`  → ${repoSummary.totalFiles} arquivos, ${repoSummary.totalDirs} diretórios, ${repoSummary.totalSizeKB} KB`);
    } catch (err) {
      log(`repo-understanding analysis falhou (non-blocking): ${err.message}`);
    }
  }

  // ─── CB.4-CB.6: SORT, ASSEMBLE, DELIVER ────────────────────────────
  let context, formatted;
  try {
    const result = cb4to6(kept, eliminated, keywords, config, rootDir, repoSummary);
    context = result.context;
    formatted = result.formatted;
  } catch (err) {
    log(`ERRO em CB.4-CB.6: ${err.message}`);
    process.exit(1);
  }

  // ─── CACHE SAVE ────────────────────────────────────────────────────
  if (config.cache_enabled) {
    try {
      const cacheModule = require('./context-cache');
      cacheModule.saveCache(keywords, { context, formatted });
      log('Cache salvo');
    } catch (err) {
      log(`Cache save falhou (non-blocking): ${err.message}`);
    }
  }

  // ─── OUTPUT ────────────────────────────────────────────────────────
  if (outputJson) {
    console.log(JSON.stringify(context, null, 2));
  } else {
    console.log(formatted);
  }

  log('Context Builder concluído com sucesso.');
}

if (require.main === module) {
  main();
}

// Export para ser usado programaticamente por pipeline-executor.js
module.exports = { main, cb1Discovery, cb2Scoring, cb3Elimination, cb4to6, loadConfig };
