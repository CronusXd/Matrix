#!/usr/bin/env node
/**
 * Matrix RAG Query v2.0
 * Consulta o índice TF-IDF + Embeddings por similaridade semântica.
 * Zero dependências externas — apenas Node.js fs + path + fetch nativo.
 *
 * Uso: node rag-query.js "sua pergunta aqui"
 *
 * Lê rag-index.json (gerado pelo rag-index.js v2.0) e retorna
 * os top-k chunks mais relevantes para a consulta.
 *
 * Modos de retrieval (definidos no índice):
 *   "tfidf"      — TF-IDF puro (fallback legado)
 *   "embeddings" — apenas embeddings semânticos via API 9router
 *   "hybrid"     — TF-IDF (0.3) + embeddings (0.7) combinados
 *
 * Se a API de embeddings falhar, faz fallback automático para TF-IDF.
 */

const fs = require('fs');
const path = require('path');
const { tokenize } = require('./lib/tokenizer');

const BASE_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.resolve(__dirname, '..', 'rag-config.yaml');

// ─── Load config ─────────────────────────────────────────────────────────
function loadConfig() {
  try {
    const { parseYaml } = require('./lib/yaml-utils');
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const yamlText = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return parseYaml(yamlText);
  } catch {
    return {};
  }
}

// ─── Similaridade de Cosseno (TF-IDF vectors) ───────────────────────────
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

// ─── Similaridade de Cosseno (embedding vectors) ────────────────────────
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

// ─── Embeddings via API 9router ──────────────────────────────────────────
async function getQueryEmbedding(text) {
  const config = loadConfig();
  const embCfg = config.rag?.embeddings || {};
  const baseURL = embCfg.base_url || 'http://127.0.0.1:20128/v1';
  const model = embCfg.model || 'kr/claude-sonnet-4.5-thinking-agentic';
  const apiKey = process.env[embCfg.api_key_env] || embCfg.api_key_fallback || '';

  // Se não há API key configurada, retorna null → gatilho para fallback automático TF-IDF
  if (!apiKey) {
    console.warn('   ⚠️  Matrix_RAG_API_KEY não configurada. Fallback automático para modo TF-IDF.');
    console.warn('   💡 Para ativar embeddings, defina Matrix_RAG_API_KEY no .env');
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

  /** @type {any} */
  const data = await response.json();

  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('API embeddings retornou formato inesperado');
  }

  return data.data[0].embedding;
}

// ─── Consulta TF-IDF ─────────────────────────────────────────────────────
function queryTFIDF(index, searchText, topK) {
  // Tokenize query
  const queryTerms = tokenize(searchText);
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
    // How many indexed docs contain this term?
    const df = index.filter(d => d.terms && d.terms.includes(term)).length;
    const tf = count / maxTF;
    // Smooth IDF to avoid division by zero
    const idf = Math.log((docCount + 1) / (df + 1)) + 1;
    queryVector[term] = tf * idf;
  }

  // Score each document
  const results = index.map((doc, idx) => {
    // Support both old (flat) and new (nested) index formats
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

// ─── Consulta por Embeddings ──────────────────────────────────────────────
async function queryEmbeddings(index, searchText, topK) {
  // Get embedding for query text
  let queryEmbedding;
  try {
    queryEmbedding = await getQueryEmbedding(searchText);
  } catch (err) {
    console.warn(`   ⚠️  API de embeddings falhou: ${err.message}`);
    console.warn(`   → Fazendo fallback para TF-IDF puro`);
    return null; // Signal to caller to use TF-IDF
  }

  // Filter docs that have embeddings
  const docsWithEmbeddings = index
    .map((doc, idx) => ({ ...doc, index: idx }))
    .filter(doc => doc.embedding && Array.isArray(doc.embedding));

  if (docsWithEmbeddings.length === 0) {
    console.warn(`   ⚠️  Nenhum embedding encontrado no índice. Reindexe com modo "hybrid" ou "embeddings".`);
    return null;
  }

  // Score each document by cosine similarity of embeddings
  const results = docsWithEmbeddings.map(doc => ({
    ...doc,
    score: cosineSimilarity(queryEmbedding, doc.embedding)
  }));

  // Sort by descending score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
}

// ─── Consulta Híbrida ────────────────────────────────────────────────────
// Combina TF-IDF (peso 0.3) + Embeddings (peso 0.7)
async function queryHybrid(index, searchText, topK, tfidfWeight, embeddingWeight) {
  tfidfWeight = tfidfWeight ?? 0.3;
  embeddingWeight = embeddingWeight ?? 0.7;

  // Verificação antecipada: se não há API key, fallback direto para TF-IDF
  const config = loadConfig();
  const embCfg = config.rag?.embeddings || {};
  const apiKey = process.env[embCfg.api_key_env] || embCfg.api_key_fallback || '';
  if (!apiKey) {
    console.warn('   🔄 Modo "hybrid" requer Matrix_RAG_API_KEY, mas não está configurada.');
    console.warn('   → Fallback automático para TF-IDF puro.');
    return queryTFIDF(index, searchText, topK);
  }

  // Get TF-IDF results (top 10 for better merging)
  const tfidfResults = queryTFIDF(index, searchText, topK * 2);

  // Get Embedding results
  let embResults = await queryEmbeddings(index, searchText, topK * 2);

  // If embeddings failed, fall back to pure TF-IDF
  if (embResults === null) {
    return tfidfResults.slice(0, topK);
  }

  // Merge results using weighted scores
  const mergedMap = new Map();

  for (const r of tfidfResults) {
    mergedMap.set(r.index, {
      file: r.file,
      chunk: r.chunk,
      content: r.content,
      tfidfScore: r.score,
      embScore: 0,
      combinedScore: r.score * tfidfWeight
    });
  }

  for (const r of embResults) {
    if (mergedMap.has(r.index)) {
      const existing = mergedMap.get(r.index);
      existing.embScore = r.score;
      existing.combinedScore = (existing.tfidfScore * tfidfWeight) + (r.score * embeddingWeight);
    } else {
      mergedMap.set(r.index, {
        file: r.file,
        chunk: r.chunk,
        content: r.content,
        tfidfScore: 0,
        embScore: r.score,
        combinedScore: r.score * embeddingWeight
      });
    }
  }

  // Convert to array, sort by combined score
  const merged = Array.from(mergedMap.values());
  merged.sort((a, b) => b.combinedScore - a.combinedScore);

  return merged.slice(0, topK);
}

// ─── Vector Store Query (NON-BLOCKING) ──────────────────────────
async function queryVectorStore(searchText, topK) {
  try {
    const vs = require('./vector-store');

    // Check if vector store is available and has data
    const vsStats = await vs.stats();
    if (!vsStats || vsStats.count === 0) {
      return [];
    }

    // Get query embedding to search vector store
    const queryEmbedding = await getQueryEmbedding(searchText);
    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      return [];
    }

    const results = await vs.searchSimilarity(queryEmbedding, topK);
    return Array.isArray(results) ? results : [];
  } catch (_) {
    // NON-BLOCKING: vector store é opcional
    return [];
  }
}

// ─── Função principal de consulta ────────────────────────────────────────
async function query(searchText, topK) {
  // Load index (supports both v1 flat array and v2 nested format)
  const indexPath = path.resolve(BASE_DIR, 'rag-index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('❌ Índice não encontrado. Execute rag-index.js primeiro.');
    console.error(`   Caminho esperado: ${indexPath}`);
    process.exit(1);
  }

  const rawIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  // Detect index format
  let index, mode;
  if (Array.isArray(rawIndex)) {
    // v1 format (flat array)
    index = rawIndex;
    mode = 'tfidf';
  } else if (rawIndex.version && rawIndex.docs) {
    // v2 format
    index = rawIndex.docs;
    mode = rawIndex.mode || 'tfidf';
  } else {
    console.error('❌ Formato de índice desconhecido.');
    process.exit(1);
  }

  if (index.length === 0) {
    return [];
  }

  topK = topK || 5;

  // ── Vector Store cache lookup (NON-BLOCKING) ──
  // Antes de consultar TF-IDF, verifica se há chunks cacheados relevantes.
  try {
    const vs = require('./vector-store');
    const cached = await vs.searchCached(searchText, topK);
    if (cached.length > 0) {
      const mapped = cached.map(c => ({
        file: c.source, chunk: 0, content: c.text, score: c.score, source: 'cache-vector-store'
      }));
      return mapped;
    }
  } catch (_) {
    // NON-BLOCKING: cache é opcional
  }

  let results;
  switch (mode) {
    case 'embeddings':
      console.warn('   🔄 Modo "embeddings" — verificando disponibilidade da API...');
      results = await queryEmbeddings(index, searchText, topK);
      if (results === null) {
        console.warn('   ⚠️  API de embeddings indisponível. Fallback automático para TF-IDF.');
        results = queryTFIDF(index, searchText, topK);
      }
      break;

    case 'hybrid':
      results = await queryHybrid(index, searchText, topK);
      break;

    case 'tfidf':
    default:
      results = queryTFIDF(index, searchText, topK);
      break;
  }

  // ── Vector Store enrichment (NON-BLOCKING) ──
  let vectorEnrichment = [];
  try {
    vectorEnrichment = await queryVectorStore(searchText, topK);
  } catch (_) {
    // NON-BLOCKING: vector store é opcional
  }

  if (vectorEnrichment.length > 0) {
    // Map vector results to result format
    const vsMapped = vectorEnrichment.map(vr => ({
      file: vr.file_path,
      chunk: vr.chunk_index,
      content: vr.content,
      score: vr.score,
      source: 'vector-store'
    }));

    // Deduplicate by (file, chunk) and merge
    const existingKeys = new Set((results || []).map(r => `${r.file}:${r.chunk}`));
    for (const vr of vsMapped) {
      const key = `${vr.file}:${vr.chunk}`;
      if (!existingKeys.has(key)) {
        results.push(vr);
        existingKeys.add(key);
      }
    }

    // Re-sort by score (combinedScore if available, else raw score)
    results.sort((a, b) => {
      const sa = a.combinedScore !== undefined ? a.combinedScore : (a.score || 0);
      const sb = b.combinedScore !== undefined ? b.combinedScore : (b.score || 0);
      return sb - sa;
    });

    // Trim to topK
    results = results.slice(0, topK);
  }

  return results;
}

// ─── CLI ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  const searchText = process.argv.slice(2).filter(a => a !== '--json').join(' ');
  const jsonMode = process.argv.includes('--json');

  if (!searchText) {
    console.error('');
    console.error('Matrix RAG Query v2.0 — Embeddings + TF-IDF');
    console.error('');
    console.error('❌ Uso: node rag-query.js "sua pergunta aqui"');
    console.error('');
    console.error('Exemplos:');
    console.error('  node rag-query.js "state machine"');
    console.error('  node rag-query.js "como funciona o login?"');
    console.error('  node rag-query.js "fable method steps"');
    console.error('  node rag-query.js "state machine" --json    # JSON output');
    console.error('');
    process.exit(1);
  }

  query(searchText).then(results => {
    if (jsonMode) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log('');
    console.log('🔍 Matrix RAG Query v2.0');
    console.log(`   "${searchText}"`);
    console.log('');

    if (!results || results.length === 0) {
      console.log('   Nenhum resultado relevante encontrado.');
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const score = r.combinedScore !== undefined ? r.combinedScore : r.score;
        const pct = (score * 100).toFixed(0);
        const bar = '█'.repeat(Math.min(Math.round(score * 30), 30));

        console.log(`   ${'─'.repeat(50)}`);
        console.log(`   [#${i + 1}] ${bar} ${pct}% relevante`);

        // Show detailed scores for hybrid mode
        if (r.tfidfScore !== undefined && r.embScore !== undefined) {
          const tfidfPct = (r.tfidfScore * 100).toFixed(0);
          const embPct = (r.embScore * 100).toFixed(0);
          console.log(`   📊 TF-IDF: ${tfidfPct}% | Embedding: ${embPct}% | Combinado: ${pct}%`);
        }

        console.log(`   📄 ${r.file} (chunk ${r.chunk})`);
        console.log(`   ${r.content}`);
        console.log('');
      }
    }

    console.log('   ─────────────────────────────────────────────');
  }).catch(err => {
    console.error('❌ Erro fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { query, queryTFIDF, queryVectorStore };
