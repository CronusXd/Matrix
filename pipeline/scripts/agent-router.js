#!/usr/bin/env node
/**
 * Matrix Agent Router v2.0 — SIMPLIFIED
 * Lookup table formal de agentes especialistas.
 * Fonte primária: AGENTS.md (Tabela de Roteamento)
 * 
 * API:
 *   selectAgent(taskType, complexity, domain, keywords) → { agent, info }
 *   getAgentInfo(agentName) → { name, description, category, ... } | null
 *   findAgentByKeywords(keywords) → agentName | null
 *   listAgentsByCategory(category) → string[]
 * 
 * Uso CLI:
 *   node agent-router.js select <taskType> [complexity]
 *   node agent-router.js list [category]
 *   node agent-router.js info <agentName>
 *   node agent-router.js search <keyword>
 */

// ─── LOOKUP TABLE — Mapeamento TaskType → Agente ──────────────────────
const TASK_TYPE_MAP = {
  // Design & UX
  design: 'ArchitectUX', ui: 'UI-Designer', ux: 'UX-Researcher',
  visual: 'design-visual-storyteller', brand: 'Brand-Guardian',
  storyboard: 'design-visual-storyteller', prototype: 'rapid-prototyper',
  wireframe: 'UI-Designer', whimsy: 'Whimsy-Injector', xr: 'XR-Interface-Architect',

  // Engineering
  code: 'senior-developer', backend: 'backend-architect',
  frontend: 'frontend-developer', fullstack: 'senior-developer',
  api: 'backend-architect', ai: 'ai-engineer', ml: 'ai-engineer',
  mobile: 'mobile-app-builder', embedded: 'embedded-firmware-engineer',
  solidity: 'solidity-smart-contract-engineer', smartcontract: 'solidity-smart-contract-engineer',
  voice: 'voice-ai-integration-engineer', wechat: 'wechat-mini-program-developer',
  multiagent: 'multi-agent-systems-architect', devops: 'devops-automator',
  infra: 'devops-automator', minimal: 'minimal-change-engineer',
  method: 'fable-method-agent', fable: 'fable-method-agent',

  // Dados & BD
  data: 'data-engineer', database: 'database-optimizer',
  sql: 'database-optimizer', query: 'database-optimizer',
  etl: 'data-engineer', email: 'email-intelligence-engineer',
  remediation: 'ai-data-remediation-engineer',

  // CMS & E-commerce
  cms: 'cms-developer', drupal: 'drupal-shopping-cart-engineer',
  wordpress: 'wordpress-shopping-cart-engineer', woocommerce: 'wordpress-shopping-cart-engineer',
  filament: 'filament-optimization-specialist',

  // DevOps & Infra
  deployment: 'devops-automator', sre: 'sre-site-reliability-engineer',
  network: 'network-engineer', ci: 'devops-automator', cd: 'devops-automator',

  // Marketing & Growth
  marketing: 'marketing-growth-hacker', seo: 'marketing-growth-hacker',
  content: 'marketing-content-creator', social: 'marketing-social-media-strategist',
  growth: 'marketing-growth-hacker', twitter: 'marketing-twitter-engager',
  instagram: 'marketing-instagram-curator', tiktok: 'marketing-tiktok-strategist',
  reddit: 'marketing-reddit-community-builder', appstore: 'App-Store-Optimizer',

  // Produto & Projetos
  product: 'product-sprint-prioritizer', project: 'project-manager-senior',
  management: 'project-manager-senior', sprint: 'product-sprint-prioritizer',
  research: 'product-trend-researcher', feedback: 'product-feedback-synthesizer',
  experiment: 'Experiment-Tracker', studio: 'Studio-Producer',

  // Testes & Qualidade
  test: 'EvidenceQA', testing: 'EvidenceQA', qa: 'EvidenceQA',
  quality: 'EvidenceQA', benchmark: 'Performance-Benchmarker',
  review: 'code-reviewer', security: 'security-agent',
  evidence: 'EvidenceQA',

  // Suporte & Operações
  support: 'Support-Responder', docs: 'technical-writer',
  technical: 'technical-writer', prompt: 'prompt-engineer',
  git: 'git-workflow-master', orgscript: 'orgscript-engineer',
  analytics: 'Analytics-Reporter', incident: 'incident-response-commander',
  it: 'it-service-manager',

  // Integrações
  integration: 'feishu-integration-developer', feishu: 'feishu-integration-developer',

  // Pipeline & Fable
  pipeline: 'AgentsOrchestrator', orchestration: 'AgentsOrchestrator',
  judge: 'fable-judge'
};

// ─── CATÁLOGO DE AGENTES ──────────────────────────────────────────────
const AGENT_CATALOG = {
  'AgentsOrchestrator': { description: 'Orquestrador — delegação, roteamento, pipeline', category: 'pipeline', seniority: 'architect' },
  'fable-method-agent': { description: 'Método Fable — análise, verificação, qualidade', category: 'pipeline', seniority: 'specialist' },
  'fable-judge': { description: 'Juiz Fable — verificação adversarial, validação', category: 'pipeline', seniority: 'architect' },
  'code-reviewer': { description: 'Revisor de código — corretude, segurança, estilo', category: 'qualidade', seniority: 'senior' },
  'senior-developer': { description: 'Desenvolvedor sênior full-stack — fallback geral', category: 'engineering', seniority: 'senior' },
  'backend-architect': { description: 'Arquiteto backend — servidores, APIs, Laravel', category: 'engineering', seniority: 'architect' },
  'frontend-developer': { description: 'Desenvolvedor frontend — React, Vue, Livewire', category: 'engineering', seniority: 'specialist' },
  'ai-engineer': { description: 'Engenheiro de IA — LLMs, ML, NLP', category: 'engineering', seniority: 'specialist' },
  'minimal-change-engineer': { description: 'Mudança mínima — alterações cirúrgicas', category: 'engineering', seniority: 'specialist' },
  'database-optimizer': { description: 'Otimizador de BD — índices, queries, performance', category: 'dados', seniority: 'specialist' },
  'data-engineer': { description: 'Engenheiro de dados — ETL, pipelines, analytics', category: 'dados', seniority: 'specialist' },
  'devops-automator': { description: 'DevOps — CI/CD, deploy, infra, cloud', category: 'devops', seniority: 'specialist' },
  'security-agent': { description: 'Segurança — vulnerabilidades, threat modeling', category: 'qualidade', seniority: 'architect' },
  'rollback-manager': { description: 'Rollback — snapshots e recuperação', category: 'suporte', seniority: 'specialist' },
  'EvidenceQA': { description: 'QA baseado em evidências — testes fundamentados', category: 'qualidade', seniority: 'specialist' },
  'technical-writer': { description: 'Escritor técnico — documentação, guias', category: 'suporte', seniority: 'specialist' },
  'prompt-engineer': { description: 'Engenheiro de prompt — design, otimização LLM', category: 'suporte', seniority: 'specialist' },
  'ArchitectUX': { description: 'Arquiteto UX — sistemas complexos, jornadas', category: 'design', seniority: 'architect' },
  'UI-Designer': { description: 'Designer de interface — pixels, design systems', category: 'design', seniority: 'specialist' },
  'UX-Researcher': { description: 'Pesquisador UX — personas, usabilidade', category: 'design', seniority: 'specialist' },
  'rapid-prototyper': { description: 'Prototipador rápido — MVPs, POCs', category: 'engineering', seniority: 'specialist' },
  'software-architect': { description: 'Arquiteto de software — patterns, plataformas', category: 'engineering', seniority: 'architect' },
  'multi-agent-systems-architect': { description: 'Sistemas multi-agente — MCP, orquestração', category: 'engineering', seniority: 'architect' },
};

// ─── CORE FUNCTIONS ──────────────────────────────────────────────────

/**
 * Seleciona o melhor agente para uma tarefa.
 * @param {string} taskType - Tipo da tarefa (code, backend, database, etc.)
 * @param {number} [complexity] - Complexidade 1-5
 * @param {string} [domain] - Domínio (opcional)
 * @param {string[]} [keywords] - Palavras-chave adicionais
 * @returns {{ agent: string, info: Object|null }}
 */
function selectAgent(taskType, complexity, domain, keywords) {
  const type = (taskType || '').toLowerCase().trim();
  const agent = TASK_TYPE_MAP[type] || TASK_TYPE_MAP['code']; // fallback para senior-developer
  const info = AGENT_CATALOG[agent] || null;
  return { agent, info };
}

/**
 * Retorna informações de um agente pelo nome.
 * @param {string} agentName
 * @returns {Object|null}
 */
function getAgentInfo(agentName) {
  return AGENT_CATALOG[agentName] || null;
}

/**
 * Busca agente por palavra-chave (texto livre).
 * @param {string[]} keywords
 * @returns {string|null}
 */
function findAgentByKeywords(keywords) {
  if (!keywords || keywords.length === 0) return null;
  const query = keywords.join(' ').toLowerCase();
  for (const [name, info] of Object.entries(AGENT_CATALOG)) {
    const haystack = (name + ' ' + info.description + ' ' + info.category).toLowerCase();
    if (keywords.some(k => haystack.includes(k.toLowerCase()))) return name;
  }
  return 'senior-developer';
}

/**
 * Lista agentes de uma categoria.
 * @param {string} category
 * @returns {string[]}
 */
function listAgentsByCategory(category) {
  return Object.entries(AGENT_CATALOG)
    .filter(([_, info]) => info.category === category)
    .map(([name]) => name);
}

/**
 * Retorna o número de agentes no catálogo.
 * @returns {number}
 */
function getAgentCount() {
  return Object.keys(AGENT_CATALOG).length;
}

// ─── CLI ─────────────────────────────────────────────────────────────
function runCLI() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  switch (cmd) {
    case 'select':
      const result = selectAgent(args[1], parseInt(args[2]) || 3);
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'list':
      if (args[1]) console.log(listAgentsByCategory(args[1]).join('\n'));
      else console.log(Object.keys(AGENT_CATALOG).join('\n'));
      break;
    case 'info':
      const info = getAgentInfo(args[1]);
      console.log(info ? JSON.stringify(info, null, 2) : 'Agente não encontrado');
      break;
    case 'search':
      console.log(findAgentByKeywords(args.slice(1)));
      break;
    default:
      console.log('Uso: node agent-router.js select <taskType> [complexity]');
      console.log('     node agent-router.js list [category]');
      console.log('     node agent-router.js info <agentName>');
      console.log('     node agent-router.js search <keyword>');
  }
}

if (require.main === module) runCLI();

module.exports = { selectAgent, getAgentInfo, findAgentByKeywords, listAgentsByCategory, getAgentCount, AGENT_CATALOG };
