#!/usr/bin/env node
/**
 * Matrix RAG Indexer v2.0
 * Indexa documentação do projeto usando TF-IDF + Embeddings via API 9router.
 * Zero dependências externas — apenas Node.js fs + path + fetch nativo.
 *
 * Uso: node rag-index.js [project_dir]
 *
 * Lê rag-config.yaml para configuração de chunk_size, overlap, modo, etc.
 * Gera rag-index.json com vetores TF-IDF E embeddings dos chunks.
 *
 * Modos de retrieval (configurados em rag-config.yaml):
 *   "tfidf"      — TF-IDF puro (fallback legado)
 *   "embeddings" — apenas embeddings semânticos
 *   "hybrid"     — TF-IDF + embeddings combinados (recomendado)
 */

const fs = require('fs');
const path = require('path');
const { parseYaml } = require('./lib/yaml-utils');
const { tokenize } = require('./lib/tokenizer');

// ─── Caminhos fixos ──────────────────────────────────────────────────────
const CONFIG_PATH = path.resolve(__dirname, '..', 'rag-config.yaml');
const BASE_DIR = path.resolve(__dirname, '..');

// ─── Load config ─────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('⚠️  rag-config.yaml não encontrado. Usando defaults.');
      return {};
    }
    const yamlText = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return parseYaml(yamlText);
  } catch (err) {
    console.warn('⚠️  Erro ao ler rag-config.yaml:', err.message);
    return {};
  }
}

// ─── Embeddings via API 9router ──────────────────────────────────────────
async function getEmbedding(text, config) {
  const embCfg = config.rag?.embeddings || {};
  const baseURL = embCfg.base_url || 'http://127.0.0.1:20128/v1';
  const model = embCfg.model || 'kr/claude-sonnet-4.5-thinking-agentic';
  const apiKey = process.env[embCfg.api_key_env] || embCfg.api_key_fallback || '';

  // Se não há API key configurada, retorna null (embedding falhou)
  if (!apiKey) {
    console.warn('   ⚠️  Nenhuma API key configurada para embeddings. Use Matrix_RAG_API_KEY no .env');
    return null;
  }

  const url = `${baseURL.replace(/\/+$/, '')}/embeddings`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      input: text
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API embeddings retornou HTTP ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('API embeddings retornou formato inesperado');
  }

  return data.data[0].embedding;
}

/**
 * Obtém embeddings para um array de textos em lotes (batch).
 * Se a API falhar, retorna null (NON-BLOCKING).
 */
async function getEmbeddingsBatch(texts, config) {
  const embCfg = config.rag?.embeddings || {};
  const batchSize = embCfg.batch_size || 10;
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(text => getEmbedding(text, config))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.warn(`   ⚠️  Embedding falhou para chunk ${i + results.length}: ${result.reason?.message || 'erro desconhecido'}`);
        results.push(null);
      }
    }

    // Pequena pausa entre lotes para não sobrecarregar a API
    if (i + batchSize < texts.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return results;
}

// ─── TF-IDF ──────────────────────────────────────────────────────────────
function computeTFIDF(docs) {
  const docCount = docs.length;
  const df = {}; // document frequency (in how many docs each term appears)

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

// ─── File finder ─────────────────────────────────────────────────────────
// Percorre recursivamente os diretórios, pulando pastas excluídas.
function findFiles(dir, patterns, excludePatterns) {
  const results = [];

  function shouldSkipDir(dirName) {
    // Always skip hidden/common dirs that are never relevant
    const normalized = dirName.replace(/\\/g, '/');
    const skipDirs = ['node_modules', '.git', '.svn', '__pycache__', '.hg'];
    for (const skip of skipDirs) {
      if (normalized === skip || normalized.endsWith('/' + skip)) return true;
    }
    // Check exclude patterns against relative path
    if (excludePatterns) {
      const relPath = path.relative(dir, normalized).replace(/\\/g, '/');
      for (const pattern of excludePatterns) {
        if (matchGlob(relPath, pattern)) return true;
      }
    }
    return false;
  }

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // permission denied, skip
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        // Check if file matches at least one include pattern
        const relPath = path.relative(dir, fullPath);
        for (const pattern of patterns) {
          if (matchGlob(relPath, pattern)) {
            results.push(fullPath);
            break;
          }
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Simple glob matching ────────────────────────────────────────────────
// Suporta: *, **, ? (apenas * e ** são usados aqui)
function matchGlob(filePath, pattern) {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob pattern to regex
  let regexStr = '';
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i];
    if (ch === '*') {
      if (i + 1 < normalizedPattern.length && normalizedPattern[i + 1] === '*') {
        // ** matches everything including path separators
        regexStr += '.*';
        i += 2;
        // Skip optional trailing /
        if (i < normalizedPattern.length && normalizedPattern[i] === '/') {
          i++;
        }
      } else {
        // * matches within a single path segment
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

// ─── Exclusion check ─────────────────────────────────────────────────────
function isExcluded(filePath, excludePatterns) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const pattern of excludePatterns) {
    if (matchGlob(normalizedPath, pattern)) {
      return true;
    }
  }
  return false;
}

// ─── Chunking ────────────────────────────────────────────────────────────
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

    // Try to break at a natural boundary (newline first, then space)
    const searchStart = Math.max(start, end - Math.floor(chunkSize * 0.3));
    const slice = content.slice(searchStart, end);
    let relBreak = slice.lastIndexOf('\n');
    if (relBreak === -1) relBreak = slice.lastIndexOf(' ');
    if (relBreak === -1 || relBreak < 10) {
      // No good break point found — cut at chunkSize
      chunks.push(content.slice(start, end));
      start = end - overlap;
    } else {
      // relBreak is relative to searchStart; convert to absolute position
      const absBreak = searchStart + relBreak;
      chunks.push(content.slice(start, absBreak));
      start = absBreak - overlap;
    }

    if (start <= 0 || start >= content.length) break;
  }

  return chunks;
}

// ─── Main indexer ────────────────────────────────────────────────────────
async function indexProject(projectDir) {
  const config = loadConfig();
  const ragCfg = config.rag || {};

  const mode = ragCfg.mode || 'tfidf';
  const includePatterns = ragCfg.include_patterns || ['*.md'];
  const excludePatterns = ragCfg.exclude_patterns || [];
  const chunkSize = ragCfg.chunk_size || 1000;
  const chunkOverlap = ragCfg.chunk_overlap || 200;
  const maxChunks = ragCfg.max_chunks || 100;
  const indexFile = ragCfg.index_file || 'rag-index.json';

  console.log(`📚 Matrix RAG Indexer v2.0`);
  console.log(`   Projeto: ${projectDir}`);
  console.log(`   Modo: ${mode}`);
  console.log(`   Include: ${includePatterns.join(', ')}`);
  console.log(`   Exclude: ${excludePatterns.join(', ')}`);
  console.log(`   Chunk size: ${chunkSize}, overlap: ${chunkOverlap}, max: ${maxChunks}`);
  console.log('');

  // Find all markdown files (exclude dirs skipped during walk)
  let files = findFiles(projectDir, includePatterns, excludePatterns);
  console.log(`   ${files.length} arquivos encontrados.`);
  if (files.length === 0) {
    console.log('⚠️  Nenhum arquivo para indexar. Verifique os padrões de inclusão.');
    console.log(`   Procurou em: ${projectDir}`);
    console.log(`   Padrões: ${includePatterns.join(', ')}`);
    const indexPath = path.resolve(BASE_DIR, indexFile);
    fs.writeFileSync(indexPath, JSON.stringify({ version: '2.0', mode, docs: [] }, null, 2));
    console.log(`✅ Índice vazio salvo em ${indexPath}`);
    return;
  }

  // Process files into chunks
  const docs = [];
  let totalChunks = 0;

  for (const filePath of files) {
    if (totalChunks >= maxChunks) {
      console.log(`   ⚠️  Atingiu limite de ${maxChunks} chunks. Ignorando arquivos restantes.`);
      break;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn(`   ⚠️  Erro ao ler ${filePath}: ${err.message}`);
      continue;
    }

    const chunks = chunkContent(content, chunkSize, chunkOverlap);

    for (let i = 0; i < chunks.length; i++) {
      if (totalChunks >= maxChunks) break;

      const terms = tokenize(chunks[i]);
      const tf = {};
      for (const term of terms) {
        tf[term] = (tf[term] || 0) + 1;
      }

      docs.push({
        file: filePath,
        chunk_index: i,
        content: chunks[i],
        terms: Object.keys(tf),
        tf: tf
      });
      totalChunks++;
    }
  }

  // Compute TF-IDF
  console.log(`   Calculando TF-IDF...`);
  computeTFIDF(docs);

  // Fetch embeddings if mode requires it
  let embeddings = null;
  if (mode === 'embeddings' || mode === 'hybrid') {
    console.log(`   Obtendo embeddings via API 9router...`);
    const chunkTexts = docs.map(d => d.content.slice(0, 8000)); // limit to 8k chars
    embeddings = await getEmbeddingsBatch(chunkTexts, config);

    const successful = embeddings.filter(e => e !== null).length;
    const failed = embeddings.filter(e => e === null).length;
    console.log(`   Embeddings: ${successful} ok, ${failed} falha(s)`);
  }

  // Save index (compact format — store TF-IDF vectors + embeddings + preview content)
  const indexPath = path.resolve(BASE_DIR, indexFile);
  const indexData = {
    version: '2.0',
    mode: mode,
    docs: docs.map((d, i) => ({
      file: d.file,
      chunk: d.chunk_index,
      content: d.content.length > 200 ? d.content.slice(0, 200) + '...' : d.content,
      tfidf: d.tfidf,
      terms: Object.keys(d.tfidf),
      embedding: embeddings ? embeddings[i] : undefined
    }))
  };

  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
  const sizeKB = (Buffer.byteLength(JSON.stringify(indexData), 'utf-8') / 1024).toFixed(1);
  console.log(`✅ RAG Index v2.0: ${docs.length} chunks indexados em ${indexPath} (${sizeKB} KB, modo: ${mode})`);
}

// ─── CLI ─────────────────────────────────────────────────────────────────
const projectDir = process.argv[2] || process.cwd();
indexProject(projectDir).catch(err => {
  console.error('❌ Erro fatal:', err.message);
  process.exit(1);
});
