#!/usr/bin/env node
/**
 * Matrix Context Compressor v1.0
 * Compressão semântica de contexto para reduzir tokens mantendo informação relevante.
 *
 * Estratégias:
 *   "truncate"       — Corta no limite de linhas (fallback seguro)
 *   "keyword_lines"  — Mantém linhas com palavras-chave + contexto adjacente (±3 linhas)
 *   "section_extract" — Extrai seções completas baseadas em headings + keywords
 *   "smart"          — Combina section_extract + keyword_lines para máxima eficiência
 *
 * Uso:
 *   const compressor = require('./context-compressor');
 *   const compressed = compressor.compressContent(conteudo, 200, 'smart', ['keyword1', 'keyword2']);
 *
 * Zero dependências externas. CommonJS.
 */

'use strict';

// ─── HELPERS DE TOKENIZAÇÃO ─────────────────────────────────────────────

/**
 * Tokeniza uma string em keywords limpas (lowercase, ≥3 chars).
 */
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-záéíóúâêîôûãõçàèìòùäëïöüñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Extrai keywords de um array ou string. Sempre retorna array lowercase.
 */
function extractKeywords(keywords) {
  if (!keywords || (Array.isArray(keywords) && keywords.length === 0)) return [];
  if (Array.isArray(keywords)) {
    return keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean);
  }
  return tokenize(String(keywords));
}

/**
 * Verifica se uma linha contém alguma das keywords (case-insensitive).
 */
function lineMatchesKeywords(line, keywords) {
  if (keywords.length === 0) return false;
  const lower = line.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

/**
 * Escapa caracteres especiais de regex numa string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── DETECÇÃO DE HEADINGS ──────────────────────────────────────────────

const HEADING_PATTERNS = [
  /^#{1,6}\s+/,                       // Markdown: # ## ### #### ##### ######
  /^[A-Z][A-Z\s\-/]+(?:\n?={3,}|-{3,})\s*$/m,  // RST-style ==== / ----
  /^\/\/+\s*[-=*!_]{3,}/,             // JS comment header: // ----- // ****
  /^\/\*{2,}\s*/,                      // JSDoc / block comment: /** ...
  /^--\s+/,                            // SQL comment heading: -- heading
  /^;+\s*[-=*!_]{3,}/                 // Lisp / config comment: ;;; -----
];

/**
 * Detecta se uma linha é um heading estrutural.
 */
function isHeadingLine(line) {
  return HEADING_PATTERNS.some(p => p.test(line));
}

// ─── ESTRATÉGIA: TRUNCATE ──────────────────────────────────────────────

/**
 * Corta o conteúdo no limite de linhas. Fallback mais seguro.
 */
function compressTruncate(content, maxLines) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;

  const kept = lines.slice(0, maxLines);
  kept.push(`// ... [truncado: ${lines.length - maxLines} linha(s) removida(s) de ${lines.length}]`);
  return kept.join('\n');
}

// ─── ESTRATÉGIA: KEYWORD_LINES ─────────────────────────────────────────

/**
 * Mantém apenas linhas que contêm palavras-chave, com contexto adjacente.
 * Adiciona marcadores de omissão para clareza.
 */
function compressKeywordLines(content, keywords, maxLines) {
  const kw = extractKeywords(keywords);
  const lines = content.split('\n');
  const CONTEXT_WINDOW = 3;

  if (kw.length === 0) return compressTruncate(content, maxLines);

  const selectedIndices = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (lineMatchesKeywords(lines[i], kw)) {
      const start = Math.max(0, i - CONTEXT_WINDOW);
      const end = Math.min(lines.length - 1, i + CONTEXT_WINDOW);
      for (let j = start; j <= end; j++) {
        selectedIndices.add(j);
      }
    }
  }

  if (selectedIndices.size === 0) {
    return compressTruncate(content, maxLines);
  }

  // Converte para array ordenado
  const sorted = [...selectedIndices].sort((a, b) => a - b);

  // Monta resultado com indicadores de omissão
  const result = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (result.length >= maxLines) {
      result.push(`// ... [limite de ${maxLines} linhas atingido]`);
      break;
    }
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      const diff = idx - lastIdx - 1;
      result.push(`// ... [${diff} linha(s) omitida(s)]`);
    }
    result.push(lines[idx]);
    lastIdx = idx;
  }

  // Estatística no final
  const totalRelevant = sorted.length;
  const totalOriginal = lines.length;
  if (result.length < totalRelevant && lastIdx >= 0) {
    result.push(`// ... [restantes ${totalRelevant - result.length + 1} linha(s) relevantes não incluídas por limite]`);
  }
  if (totalOriginal > totalRelevant) {
    const saved = totalOriginal - totalRelevant;
    result.push(`// [compressão keyword_lines: ${totalRelevant}/${totalOriginal} linhas, ${saved} removida(s)]`);
  }

  return result.join('\n');
}

// ─── ESTRATÉGIA: SECTION_EXTRACT ────────────────────────────────────────

/**
 * Divide conteúdo em seções por headings, pontua cada uma por relevância,
 * e retorna as seções mais relevantes.
 */
function compressSectionExtract(content, keywords, maxLines) {
  const kw = extractKeywords(keywords);
  const lines = content.split('\n');

  if (kw.length === 0) return compressTruncate(content, maxLines);

  // 1. Identifica seções baseadas em headings
  const sections = [];
  let currentSection = { heading: '(início)', startLine: 0, lines: [], lineIndices: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeadingLine(line)) {
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: line.trim(),
        startLine: i,
        lines: [line],
        lineIndices: [i]
      };
    } else {
      currentSection.lines.push(line);
      currentSection.lineIndices.push(i);
    }
  }
  // Última seção
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  // 2. Pontua cada seção por densidade de keywords
  const scored = sections.map(sec => {
    let keywordCount = 0;
    const matchedKeywords = new Set();
    for (const idx of sec.lineIndices) {
      if (lineMatchesKeywords(lines[idx], kw)) {
        keywordCount++;
        for (const keyword of kw) {
          if (lines[idx].toLowerCase().includes(keyword)) {
            matchedKeywords.add(keyword);
          }
        }
      }
    }
    const density = keywordCount / Math.max(1, sec.lineIndices.length);
    return { ...sec, keywordCount, density, matchedKeywords: [...matchedKeywords] };
  });

  // 3. Filtra seções com pelo menos 1 match
  const relevantSections = scored.filter(s => s.keywordCount > 0);

  if (relevantSections.length === 0) {
    return compressTruncate(content, maxLines);
  }

  // 4. Monta resultado na ordem original, mantendo só seções relevantes + transição
  const result = [];
  let totalLines = 0;

  for (let i = 0; i < scored.length; i++) {
    const sec = scored[i];
    if (sec.keywordCount === 0) {
      // Seção sem match — adiciona indicador só se há seções adjacentes relevantes
      const prevRelevant = i > 0 && scored[i - 1].keywordCount > 0;
      const nextRelevant = i < scored.length - 1 && scored[i + 1].keywordCount > 0;
      if (prevRelevant || nextRelevant) {
        if (totalLines < maxLines) {
          result.push('');
          result.push(`// ... seção "${sec.heading}" omitida (0/${sec.lineIndices.length} linhas relevantes)`);
          totalLines += 2;
        }
      }
      continue;
    }

    // Seção relevante: inclui heading + linhas
    if (totalLines > 0 && result[result.length - 1] !== '') {
      result.push('');
      totalLines++;
    }

    for (const line of sec.lines) {
      if (totalLines >= maxLines) {
        result.push(`// ... [limite de ${maxLines} linhas atingido]`);
        totalLines++;
        break;
      }
      result.push(line);
      totalLines++;
    }

    if (totalLines >= maxLines) break;
  }

  // Estatística final
  const originalLines = lines.length;
  const keptLines = scored
    .filter(s => s.keywordCount > 0)
    .reduce((sum, s) => sum + s.lineIndices.length, 0);

  if (originalLines > keptLines) {
    result.push(`// [compressão section_extract: ${keptLines}/${originalLines} linhas, ${originalLines - keptLines} removida(s)]`);
  }

  return result.join('\n');
}

// ─── ESTRATÉGIA: SMART ──────────────────────────────────────────────────

/**
 * Combina section_extract + keyword_lines:
 * 1. Extrai seções completas com keywords
 * 2. Nas linhas não extraídas, aplica keyword_lines com janela menor (2)
 * 3. Merge ordenado preservando ordem original
 */
function compressSmart(content, keywords, maxLines) {
  const kw = extractKeywords(keywords);
  const lines = content.split('\n');

  if (kw.length === 0) return compressTruncate(content, maxLines);

  if (lines.length <= maxLines) return content;

  // 1. Extrai linhas de seções relevantes
  const { extractedLineIndices } = extractRawSections(lines, kw);
  const allSelected = new Set(extractedLineIndices);

  // 2. Para linhas NÃO extraídas, aplica keyword_lines com janela 2
  const CONTEXT_WINDOW = 2;
  for (let i = 0; i < lines.length; i++) {
    if (allSelected.has(i)) continue; // já está incluída por seção
    if (lineMatchesKeywords(lines[i], kw)) {
      const start = Math.max(0, i - CONTEXT_WINDOW);
      const end = Math.min(lines.length - 1, i + CONTEXT_WINDOW);
      for (let j = start; j <= end; j++) {
        allSelected.add(j);
      }
    }
  }

  // 3. Ordena
  const sorted = [...allSelected].sort((a, b) => a - b);

  // 4. Monta resultado
  const result = [];
  let lastIdx = -1;

  for (const idx of sorted) {
    if (result.length >= maxLines) {
      result.push(`// ... [limite de ${maxLines} linhas atingido]`);
      break;
    }
    if (lastIdx >= 0 && idx > lastIdx + 1) {
      const diff = idx - lastIdx - 1;
      result.push(`// ... [${diff} linha(s) omitida(s)]`);
    }
    result.push(lines[idx]);
    lastIdx = idx;
  }

  // Estatística
  const totalOriginal = lines.length;
  const totalKept = allSelected.size;
  if (totalOriginal > totalKept) {
    result.push(`// [compressão smart: ${totalKept}/${totalOriginal} linhas, ${totalOriginal - totalKept} removida(s)]`);
  }

  return result.join('\n');
}

/**
 * Extrai seções relevantes do conteúdo baseado em headings + keywords.
 * Retorna quais índices de linha foram extraídos e as seções identificadas.
 */
function extractRawSections(lines, keywords) {
  const kw = extractKeywords(keywords);
  const extractedLineIndices = new Set();

  if (kw.length === 0) return { extractedLineIndices, sections: [] };

  // Identifica seções
  const sections = [];
  let currentSection = { heading: '(início)', startLine: 0, lineIndices: [] };

  for (let i = 0; i < lines.length; i++) {
    if (isHeadingLine(lines[i])) {
      if (currentSection.lineIndices.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { heading: lines[i].trim(), startLine: i, lineIndices: [i] };
    } else {
      currentSection.lineIndices.push(i);
    }
  }
  if (currentSection.lineIndices.length > 0) {
    sections.push(currentSection);
  }

  // Pontua seções
  const scored = sections.map(sec => {
    let keywordCount = 0;
    for (const idx of sec.lineIndices) {
      if (lineMatchesKeywords(lines[idx], kw)) {
        keywordCount++;
      }
    }
    const density = keywordCount / Math.max(1, sec.lineIndices.length);
    return { ...sec, keywordCount, density };
  });

  // Marca linhas de seções com pelo menos 1 match
  for (const sec of scored) {
    if (sec.keywordCount > 0) {
      for (const idx of sec.lineIndices) {
        extractedLineIndices.add(idx);
      }
    }
  }

  return { extractedLineIndices, sections: scored };
}

// ─── FUNÇÃO PRINCIPAL: DISPATCH ─────────────────────────────────────────

/**
 * Comprime conteúdo usando a estratégia especificada.
 *
 * @param {string} content - Conteúdo original
 * @param {number} maxLines - Máximo de linhas no resultado (padrão: 500)
 * @param {string} strategy - Estratégia: truncate | keyword_lines | section_extract | smart (padrão)
 * @param {string|string[]} keywords - Palavras-chave para compressão semântica
 * @returns {string} Conteúdo comprimido
 */
function compressContent(content, maxLines = 500, strategy = 'smart', keywords = []) {
  if (!content || typeof content !== 'string') return '';
  if (maxLines <= 0) return '';

  const kw = extractKeywords(keywords);
  const lines = content.split('\n');

  // Se o conteúdo já é menor que o limite, retorna intacto
  if (lines.length <= maxLines) return content;

  switch (strategy) {
    case 'truncate':
      return compressTruncate(content, maxLines);
    case 'keyword_lines':
      return compressKeywordLines(content, kw, maxLines);
    case 'section_extract':
      return compressSectionExtract(content, kw, maxLines);
    case 'smart':
      return compressSmart(content, kw, maxLines);
    default:
      return compressTruncate(content, maxLines);
  }
}

// ─── FUNÇÕES ADICIONAIS DA API ──────────────────────────────────────────

/**
 * Extrai seções relevantes do conteúdo baseado em palavras-chave.
 * Similar a compressSectionExtract mas retorna dados estruturados em vez de string.
 *
 * @param {string} content - Conteúdo original
 * @param {string|string[]} keywords - Palavras-chave
 * @returns {Array<{heading: string, content: string, score: number, density: number, lineCount: number}>}
 */
function extractKeySections(content, keywords) {
  if (!content || typeof content !== 'string') return [];

  const kw = extractKeywords(keywords);
  const lines = content.split('\n');

  if (kw.length === 0) return [{ heading: '(conteúdo completo)', content, score: 1, density: 1, lineCount: lines.length }];

  // Identifica seções
  const sections = [];
  let currentSection = { heading: '(início)', startLine: 0, lines: [], lineIndices: [] };

  for (let i = 0; i < lines.length; i++) {
    if (isHeadingLine(lines[i])) {
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: lines[i].trim(),
        startLine: i,
        lines: [lines[i]],
        lineIndices: [i]
      };
    } else {
      currentSection.lines.push(lines[i]);
      currentSection.lineIndices.push(i);
    }
  }
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  // Pontua e retorna
  return sections.map(sec => {
    let keywordCount = 0;
    const matchedKeywords = new Set();
    for (const idx of sec.lineIndices) {
      if (lineMatchesKeywords(lines[idx], kw)) {
        keywordCount++;
        for (const k of kw) {
          if (lines[idx].toLowerCase().includes(k)) {
            matchedKeywords.add(k);
          }
        }
      }
    }
    const density = keywordCount / Math.max(1, sec.lineIndices.length);

    return {
      heading: sec.heading,
      content: sec.lines.join('\n'),
      score: keywordCount,
      density,
      lineCount: sec.lineIndices.length,
      matchedKeywords: [...matchedKeywords]
    };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.density - a.density || b.score - a.score);
}

/**
 * Sumariza conteúdo por relevância, limitado a maxChars.
 * Estratégia híbrida: extrai seções + linhas-chave até atingir o limite.
 *
 * @param {string} content - Conteúdo original
 * @param {string|string[]} keywords - Palavras-chave
 * @param {number} maxChars - Limite máximo de caracteres
 * @returns {string} Conteúdo sumarizado
 */
function summarizeByRelevance(content, keywords, maxChars = 8000) {
  if (!content || typeof content !== 'string') return '';
  if (content.length <= maxChars) return content;

  const kw = extractKeywords(keywords);

  if (kw.length === 0) return content.slice(0, maxChars) + `\n// ... [truncado: ${content.length - maxChars} caracteres]`;

  // Converte maxChars para estimativa de linhas (média 50 chars/linha)
  const estimatedLines = Math.max(50, Math.floor(maxChars / 50));

  // Usa compressão smart para manter conteúdo relevante
  const compressed = compressSmart(content, kw, estimatedLines);

  // Se ainda excede, corta por caracteres
  if (compressed.length > maxChars) {
    return compressed.slice(0, maxChars - 50) +
      `\n// ... [truncado por caracteres: ${compressed.length - maxChars} removidos]`;
  }

  return compressed;
}

/**
 * Calcula a taxa de compressão entre conteúdo original e comprimido.
 *
 * @param {string} original - Conteúdo original
 * @param {string} compressed - Conteúdo comprimido
 * @returns {{ ratio: number, originalChars: number, compressedChars: number,
 *             originalLines: number, compressedLines: number, saved: number,
 *             savedPercent: string }}
 */
function getCompressionRatio(original, compressed) {
  if (!original || !compressed) {
    return {
      ratio: 1,
      originalChars: 0,
      compressedChars: 0,
      originalLines: 0,
      compressedLines: 0,
      saved: 0,
      savedPercent: '0%'
    };
  }

  const originalChars = original.length;
  const compressedChars = compressed.length;
  const originalLines = original.split('\n').length;
  const compressedLines = compressed.split('\n').length;

  const ratio = originalChars > 0 ? +(compressedChars / originalChars).toFixed(4) : 1;
  const saved = originalChars - compressedChars;
  const savedPercent = originalChars > 0
    ? ((saved / originalChars) * 100).toFixed(1) + '%'
    : '0%';

  return {
    ratio,
    originalChars,
    compressedChars,
    originalLines,
    compressedLines,
    saved,
    savedPercent
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

/**
 * Modo CLI: node context-compressor.js <arquivo> [--strategy <s>] [--max-lines <n>] [--keywords <k1,k2>]
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Matrix Context Compressor v1.0

Uso:
  node context-compressor.js <arquivo> [opções]

Opções:
  --strategy <s>    Estratégia: truncate | keyword_lines | section_extract | smart (padrão)
  --max-lines <n>   Máximo de linhas na saída (padrão: 500)
  --keywords <k>    Palavras-chave separadas por vírgula
  --ratio           Mostrar apenas estatísticas de compressão
  --json            Saída em JSON
  --help            Esta ajuda

Exemplos:
  node context-compressor.js meu-arquivo.js --strategy smart --keywords "db,query,model" --max-lines 100
  node context-compressor.js meu-arquivo.js --ratio --keywords "api"
`);
    process.exit(0);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  let strategy = 'smart';
  let maxLines = 500;
  let keywords = [];
  let showRatio = false;
  let jsonOutput = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--strategy' && i + 1 < args.length) {
      strategy = args[++i];
    } else if (args[i] === '--max-lines' && i + 1 < args.length) {
      maxLines = parseInt(args[++i], 10) || 500;
    } else if (args[i] === '--keywords' && i + 1 < args.length) {
      keywords = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (args[i] === '--ratio') {
      showRatio = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const compressed = compressContent(content, maxLines, strategy, keywords);
  const ratio = getCompressionRatio(content, compressed);

  if (showRatio || jsonOutput) {
    const output = {
      file: path.basename(filePath),
      strategy,
      maxLines,
      keywords,
      ...ratio
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(compressed);
    console.error(`\n[compressão: ${ratio.savedPercent} economizado, ${compressed.length}/${content.length} chars, ${ratio.compressedLines}/${ratio.originalLines} linhas]`);
  }
}

const fs = require('fs');
const path = require('path');

// ─── API PÚBLICA ────────────────────────────────────────────────────────

module.exports = {
  compressContent,
  extractKeySections,
  summarizeByRelevance,
  getCompressionRatio
};

// Execução direta
if (require.main === module) {
  main();
}
