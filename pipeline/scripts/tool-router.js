#!/usr/bin/env node
/**
 * Matrix Tool Router v1.0
 * Roteador formal de ferramentas para o pipeline Matrix.
 * Mapeia tipos de tarefa → ferramentas recomendadas com regras de acesso.
 *
 * API:
 *   { getTools(taskType, complexity), getToolInfo(toolName),
 *     listTools(), routeTask(taskDescription, options),
 *     getToolCategories(), getConfig(), reloadConfig() }
 *
 * Regras de roteamento:
 *   - Leitura de arquivos         → read, glob, grep
 *   - Pesquisa na internet        → webfetch, agent-reach
 *   - Modificação de código       → edit, write (restringir a especialistas)
 *   - Execução de comandos        → bash
 *   - Delegação                   → task
 *   - Pipeline management         → state_machine, todowrite
 *   - Git operations              → git (via bash)
 *   - Database                    → supabase_* tools
 *
 * Uso CLI:
 *   node tool-router.js tools <taskType> [complexity]
 *   node tool-router.js info <toolName>
 *   node tool-router.js list [category]
 *   node tool-router.js route <taskDescription>
 *   node tool-router.js categories
 *   node tool-router.js config
 *   node tool-router.js reload
 *   node tool-router.js --help
 */

const fs = require('fs');
const path = require('path');
const { parseYaml, stripQuotes } = require('./lib/yaml-utils');

// ─── Caminhos Absolutos ───────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(__dirname, 'tool-router.yaml');

// ─── Cores para Terminal ──────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// =====================================================================
//  Mapa de Ferramentas — Definição Central
// =====================================================================

/**
 * Catálogo completo de ferramentas disponíveis, organizadas por categoria.
 * Cada ferramenta possui:
 *   - name:        Nome único da ferramenta
 *   - category:    Categoria funcional
 *   - description: Descrição do propósito
 *   - restricted:  Se true, apenas especialistas autorizados podem usar
 *   - aliases:     Nomes alternativos (para matching em rotas)
 *   - complexityMax: Complexidade máxima suportada (1-5)
 *   - taskTypes:   Tipos de tarefa que esta ferramenta atende
 */
var TOOL_CATALOG = {
  // ── Leitura ────────────────────────────────────────────────────────
  read: {
    name: 'read',
    category: 'leitura',
    description: 'Leitura de arquivos do sistema de arquivos local',
    restricted: false,
    aliases: ['cat', 'view', 'open', 'ler'],
    complexityMax: 5,
    taskTypes: ['read', 'view', 'list', 'show', 'display', 'examine', 'inspect', 'check', 'cat']
  },
  glob: {
    name: 'glob',
    category: 'leitura',
    description: 'Busca de arquivos por padrão glob (wildcards)',
    restricted: false,
    aliases: ['find', 'search-files', 'wildcard', 'ls'],
    complexityMax: 5,
    taskTypes: ['search-files', 'find-file', 'locate', 'glob', 'list-files']
  },
  grep: {
    name: 'grep',
    category: 'leitura',
    description: 'Busca de conteúdo textual em arquivos (regex)',
    restricted: false,
    aliases: ['search-content', 'rg', 'findstr', 'text-search', 'regex-search'],
    complexityMax: 5,
    taskTypes: ['search-content', 'text-search', 'grep', 'find-in-files', 'code-search']
  },

  // ── Escrita (Restrita) ─────────────────────────────────────────────
  edit: {
    name: 'edit',
    category: 'escrita',
    description: 'Edição cirúrgica de arquivos (string replace)',
    restricted: true,
    aliases: ['modify', 'replace', 'patch', 'alter', 'change', 'update'],
    complexityMax: 5,
    taskTypes: ['edit', 'modify', 'replace', 'update', 'change', 'patch', 'correct', 'fix']
  },
  write: {
    name: 'write',
    category: 'escrita',
    description: 'Escrita/sobrescrita completa de arquivos',
    restricted: true,
    aliases: ['create', 'save', 'overwrite', 'output'],
    complexityMax: 5,
    taskTypes: ['create', 'write', 'save', 'generate-file', 'output-file']
  },

  // ── Execução ───────────────────────────────────────────────────────
  bash: {
    name: 'bash',
    category: 'execucao',
    description: 'Execução de comandos shell no terminal',
    restricted: false,
    aliases: ['shell', 'cmd', 'terminal', 'exec', 'run', 'command', 'sh', 'powershell'],
    complexityMax: 5,
    taskTypes: ['execute', 'run', 'build', 'compile', 'deploy', 'install', 'test', 'shell', 'command']
  },
  terminal: {
    name: 'terminal',
    category: 'execucao',
    description: 'Acesso interativo ao terminal (alias para bash)',
    restricted: false,
    aliases: ['console', 'prompt', 'cmd'],
    complexityMax: 5,
    taskTypes: ['interactive', 'terminal', 'console']
  },

  // ── Pesquisa ───────────────────────────────────────────────────────
  webfetch: {
    name: 'webfetch',
    category: 'pesquisa',
    description: 'Download e parsing de conteúdo web via URL',
    restricted: false,
    aliases: ['fetch', 'web', 'http', 'url', 'download'],
    complexityMax: 5,
    taskTypes: ['fetch-url', 'web-fetch', 'http-request', 'scrape', 'download-url']
  },
  'agent-reach': {
    name: 'agent-reach',
    category: 'pesquisa',
    description: 'Pesquisa multi-plataforma na internet (15 plataformas)',
    restricted: false,
    aliases: ['reach', 'research', 'search-web', 'internet-search', 'social-search'],
    complexityMax: 5,
    taskTypes: ['research', 'search-web', 'internet-research', 'lookup', 'social-search']
  },

  // ── Delegação ──────────────────────────────────────────────────────
  task: {
    name: 'task',
    category: 'delegacao',
    description: 'Delegação de subtarefas para agentes especializados',
    restricted: true,
    aliases: ['delegate', 'assign', 'subtask', 'agent-task'],
    complexityMax: 5,
    taskTypes: ['delegate', 'assign', 'subtask', 'parallel', 'dispatch']
  },

  // ── Git ────────────────────────────────────────────────────────────
  git: {
    name: 'git',
    category: 'git',
    description: 'Operações Git (commit, push, branch, etc.)',
    restricted: false,
    aliases: ['version-control', 'vcs', 'scm'],
    complexityMax: 5,
    taskTypes: ['commit', 'push', 'pull', 'branch', 'merge', 'clone', 'git']
  },

  // ── Pipeline ───────────────────────────────────────────────────────
  state_machine: {
    name: 'state_machine',
    category: 'pipeline',
    description: 'Operações na state machine do pipeline (state.json)',
    restricted: false,
    aliases: ['state', 'transition', 'pipeline-state'],
    complexityMax: 5,
    taskTypes: ['transition', 'state-change', 'pipeline-state', 'state-machine']
  },
  todowrite: {
    name: 'todowrite',
    category: 'pipeline',
    description: 'Escrita e gerenciamento de todo lists do pipeline',
    restricted: true,
    aliases: ['todo', 'checklist', 'task-list', 'todolist'],
    complexityMax: 5,
    taskTypes: ['create-todo', 'update-todo', 'mark-done', 'checklist']
  },

  // ── Database (Supabase) ────────────────────────────────────────────
  'supabase_execute_sql': {
    name: 'supabase_execute_sql',
    category: 'database',
    description: 'Execução de SQL no Supabase PostgreSQL',
    restricted: true,
    aliases: ['supabase-sql', 'supabase-query', 'db-query'],
    complexityMax: 5,
    taskTypes: ['query', 'sql', 'database-query', 'supabase-sql']
  },
  'supabase_apply_migration': {
    name: 'supabase_apply_migration',
    category: 'database',
    description: 'Aplicação de migrations DDL no Supabase',
    restricted: true,
    aliases: ['migration', 'supabase-migrate', 'ddl'],
    complexityMax: 5,
    taskTypes: ['migration', 'ddl', 'schema-change', 'supabase-migrate']
  },
  'supabase_list_tables': {
    name: 'supabase_list_tables',
    category: 'database',
    description: 'Listagem de tabelas do banco Supabase',
    restricted: false,
    aliases: ['list-tables', 'show-tables', 'supabase-tables'],
    complexityMax: 3,
    taskTypes: ['list-tables', 'show-schema', 'database-info']
  },
  'supabase_generate_typescript_types': {
    name: 'supabase_generate_typescript_types',
    category: 'database',
    description: 'Geração de tipos TypeScript a partir do schema Supabase',
    restricted: false,
    aliases: ['gen-types', 'ts-types', 'supabase-types'],
    complexityMax: 3,
    taskTypes: ['generate-types', 'ts-types', 'type-generation']
  }
};

// =====================================================================
//  Configuração Padrão
// =====================================================================

var DEFAULT_CONFIG = {
  settings: {
    defaultCategory: 'leitura',
    restrictedByDefault: false,
    maxToolsPerRoute: 5,
    enableLogging: true,
    enableRestrictions: true,
    restrictedRoles: ['specialist', 'admin', 'senior-developer']
  },
  categories: {
    leitura: {
      description: 'Ferramentas de leitura e busca (não modificam arquivos)',
      icon: '📖',
      priority: 1
    },
    escrita: {
      description: 'Ferramentas de escrita e modificação de código (restritas)',
      icon: '✏️',
      priority: 2,
      restricted: true
    },
    execucao: {
      description: 'Execução de comandos e scripts',
      icon: '⚡',
      priority: 3
    },
    pesquisa: {
      description: 'Pesquisa na internet e web scraping',
      icon: '🔍',
      priority: 4
    },
    delegacao: {
      description: 'Delegação de tarefas para agentes especializados',
      icon: '📋',
      priority: 5,
      restricted: true
    },
    git: {
      description: 'Operações de controle de versão Git',
      icon: '🔀',
      priority: 6
    },
    pipeline: {
      description: 'Gerenciamento do pipeline e state machine',
      icon: '⚙️',
      priority: 7
    },
    database: {
      description: 'Operações em banco de dados (Supabase)',
      icon: '🗄️',
      priority: 8,
      restricted: true
    }
  },
  taskRouting: {
    file_read: {
      taskTypes: ['read', 'view', 'list', 'show', 'display', 'examine', 'inspect', 'check', 'cat',
                  'search-files', 'find-file', 'locate', 'glob', 'list-files',
                  'search-content', 'text-search', 'grep', 'find-in-files', 'code-search'],
      preferredTools: ['read', 'glob', 'grep'],
      allowRestricted: false,
      description: 'Leitura e busca de arquivos'
    },
    code_modification: {
      taskTypes: ['edit', 'modify', 'replace', 'update', 'change', 'patch', 'correct', 'fix',
                  'create', 'write', 'save', 'generate-file', 'output-file'],
      preferredTools: ['edit', 'write'],
      allowRestricted: true,
      minRole: 'specialist',
      description: 'Modificação de código-fonte'
    },
    command_execution: {
      taskTypes: ['execute', 'run', 'build', 'compile', 'deploy', 'install', 'test', 'shell', 'command',
                  'interactive', 'terminal', 'console'],
      preferredTools: ['bash'],
      allowRestricted: false,
      description: 'Execução de comandos e scripts'
    },
    internet_search: {
      taskTypes: ['research', 'search-web', 'internet-research', 'lookup', 'social-search',
                  'fetch-url', 'web-fetch', 'http-request', 'scrape', 'download-url'],
      preferredTools: ['webfetch', 'agent-reach'],
      allowRestricted: false,
      description: 'Pesquisa na internet e web scraping'
    },
    delegation: {
      taskTypes: ['delegate', 'assign', 'subtask', 'parallel', 'dispatch'],
      preferredTools: ['task'],
      allowRestricted: true,
      minRole: 'specialist',
      description: 'Delegação de tarefas para agentes'
    },
    git_operations: {
      taskTypes: ['commit', 'push', 'pull', 'branch', 'merge', 'clone', 'git'],
      preferredTools: ['git', 'bash'],
      allowRestricted: false,
      description: 'Operações de controle de versão'
    },
    pipeline_management: {
      taskTypes: ['transition', 'state-change', 'pipeline-state', 'state-machine',
                  'create-todo', 'update-todo', 'mark-done', 'checklist'],
      preferredTools: ['state_machine', 'todowrite'],
      allowRestricted: false,
      description: 'Gerenciamento do pipeline'
    },
    database: {
      taskTypes: ['query', 'sql', 'database-query', 'supabase-sql',
                  'migration', 'ddl', 'schema-change', 'supabase-migrate',
                  'list-tables', 'show-schema', 'database-info',
                  'generate-types', 'ts-types', 'type-generation'],
      preferredTools: ['supabase_execute_sql', 'supabase_apply_migration', 'supabase_list_tables', 'supabase_generate_typescript_types'],
      allowRestricted: true,
      minRole: 'specialist',
      description: 'Operações em banco de dados'
    }
  },
  // Mapa de sinônimos de taskType → routing key
  typeSynonyms: {
    'ler': 'read',
    'criar': 'create',
    'modificar': 'edit',
    'deletar': 'delete',
    'remover': 'delete',
    'executar': 'execute',
    'pesquisar': 'research',
    'procurar': 'research',
    'buscar': 'research',
    'delegar': 'delegate',
    'commitar': 'commit',
    'publicar': 'push',
    'deploy': 'deploy',
    'instalar': 'install',
    'testar': 'test'
  }
};

// Cache da config carregada
var _config = null;

// =====================================================================
//  Config Loading
// =====================================================================

/**
 * Parseia tool-router.yaml para objeto JS usando o parser YAML unificado.
 */
function parseConfigYaml(text) {
  const parsed = parseYaml(text);

  if (!parsed.settings || typeof parsed.settings !== 'object') {
    parsed.settings = {};
  }
  if (!parsed.categories || typeof parsed.categories !== 'object') {
    parsed.categories = {};
  }
  if (!parsed.taskRouting || typeof parsed.taskRouting !== 'object') {
    parsed.taskRouting = {};
  }

  return parsed;
}

/**
 * Carrega a configuração do tool-router.yaml.
 * Se o arquivo não existir, usa configuração padrão.
 * NON-BLOCKING: se falhar, usa defaults.
 *
 * @returns {Object} Configuração carregada
 */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = parseConfigYaml(raw);

    // Merge com defaults
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // Merge settings
    if (parsed.settings) {
      Object.keys(config.settings).forEach(function(key) {
        if (parsed.settings[key] !== undefined) {
          config.settings[key] = parsed.settings[key];
        }
      });
    }

    // Merge categories (substitui descrição, icon, priority)
    if (parsed.categories) {
      Object.keys(parsed.categories).forEach(function(catKey) {
        if (config.categories[catKey]) {
          Object.assign(config.categories[catKey], parsed.categories[catKey]);
        } else {
          config.categories[catKey] = parsed.categories[catKey];
        }
      });
    }

    // Merge taskRouting (substitui completamente rotas se definidas)
    if (parsed.taskRouting) {
      Object.keys(parsed.taskRouting).forEach(function(routeKey) {
        if (config.taskRouting[routeKey]) {
          Object.assign(config.taskRouting[routeKey], parsed.taskRouting[routeKey]);
        } else {
          config.taskRouting[routeKey] = parsed.taskRouting[routeKey];
        }
      });
    }

    // Merge typeSynonyms
    if (parsed.typeSynonyms && typeof parsed.typeSynonyms === 'object') {
      Object.keys(parsed.typeSynonyms).forEach(function(synKey) {
        config.typeSynonyms[synKey] = parsed.typeSynonyms[synKey];
      });
    }

    return config;
  } catch (err) {
    console.warn(YELLOW + '⚠️  tool-router: loadConfig falhou (NON-BLOCKING): ' + err.message + RESET);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

/**
 * Retorna a configuração atual (com cache).
 *
 * @returns {Object} Configuração
 */
function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

/**
 * Recarrega a configuração do disco (invalida cache).
 *
 * @returns {Object} Nova configuração
 */
function reloadConfig() {
  _config = loadConfig();
  return _config;
}

// =====================================================================
//  API Principal
// =====================================================================

/**
 * Retorna o catálogo completo de ferramentas organizado por categoria.
 *
 * @returns {Object} Mapa categorias → ferramentas
 */
function getToolCategories() {
  var categories = {};
  var toolNames = Object.keys(TOOL_CATALOG);

  toolNames.forEach(function(toolName) {
    var tool = TOOL_CATALOG[toolName];
    var cat = tool.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(tool);
  });

  return categories;
}

/**
 * Lista todas as ferramentas disponíveis, opcionalmente filtradas por categoria.
 *
 * @param {string} [category] - Categoria para filtrar (opcional)
 * @returns {Array} Lista de ferramentas
 */
function listTools(category) {
  var toolNames = Object.keys(TOOL_CATALOG);
  var result = [];

  toolNames.forEach(function(toolName) {
    var tool = TOOL_CATALOG[toolName];
    if (!category || tool.category === category) {
      result.push({
        name: tool.name,
        category: tool.category,
        description: tool.description,
        restricted: tool.restricted,
        complexityMax: tool.complexityMax,
        aliases: tool.aliases,
        taskTypes: tool.taskTypes
      });
    }
  });

  return result;
}

/**
 * Retorna informações detalhadas sobre uma ferramenta específica.
 * Busca por nome exato primeiro, depois por alias.
 *
 * @param {string} toolName - Nome ou alias da ferramenta
 * @returns {Object|null} Informações da ferramenta ou null se não encontrada
 */
function getToolInfo(toolName) {
  if (!toolName || typeof toolName !== 'string') return null;

  var name = toolName.toLowerCase().trim();

  // Busca por nome exato
  if (TOOL_CATALOG[name]) {
    return JSON.parse(JSON.stringify(TOOL_CATALOG[name]));
  }

  // Busca por alias
  var toolNames = Object.keys(TOOL_CATALOG);
  for (var i = 0; i < toolNames.length; i++) {
    var tool = TOOL_CATALOG[toolNames[i]];
    if (tool.aliases.indexOf(name) !== -1) {
      return JSON.parse(JSON.stringify(tool));
    }
  }

  return null;
}

/**
 * Normaliza um taskType usando o mapa de sinônimos.
 *
 * @param {string} taskType - Tipo de tarefa a normalizar
 * @returns {string} TaskType normalizado
 */
function normalizeTaskType(taskType) {
  if (!taskType || typeof taskType !== 'string') return 'unknown';
  var lower = taskType.toLowerCase().trim();
  var config = getConfig();
  return config.typeSynonyms[lower] || lower;
}

/**
 * Identifica a rota de taskRouting correspondente a um taskType.
 *
 * @param {string} taskType - Tipo de tarefa normalizado
 * @returns {string|null} Chave da rota (ex: 'file_read') ou null
 */
function identifyRoute(taskType) {
  if (!taskType) return null;

  var config = getConfig();
  var routes = config.taskRouting;
  var routeKeys = Object.keys(routes);
  var lowerType = taskType.toLowerCase();

  for (var i = 0; i < routeKeys.length; i++) {
    var routeKey = routeKeys[i];
    var route = routes[routeKey];
    if (route.taskTypes && route.taskTypes.indexOf(lowerType) !== -1) {
      return routeKey;
    }
  }

  return null;
}

/**
 * Retorna as ferramentas recomendadas para um tipo de tarefa e complexidade.
 *
 * Algoritmo de roteamento:
 *   1. Normaliza taskType (via typeSynonyms)
 *   2. Identifica a rota correspondente (via taskRouting.taskTypes)
 *   3. Se rota encontrada, retorna preferredTools filtrados por complexityMax
 *   4. Se não encontrada, busca match parcial no TOOL_CATALOG
 *   5. Fallback: ferramentas da categoria padrão (leitura)
 *
 * @param {string} taskType - Tipo da tarefa (ex: 'edit', 'research', 'execute')
 * @param {number} [complexity=1] - Nível de complexidade (1-5)
 * @param {Object} [options] - Opções adicionais
 * @param {string} [options.role] - Role do agente (para verificar restrições)
 * @returns {{
 *   tools: Array<{name: string, category: string, description: string, restricted: boolean}>,
 *   route: string|null,
 *   taskType: string,
 *   reason: string
 * }}
 */
function getTools(taskType, complexity, options) {
  var config = getConfig();
  options = options || {};

  var complexityNum = (typeof complexity === 'number' && complexity >= 1 && complexity <= 5)
    ? complexity : 1;

  var rawType = (taskType || '').trim();
  var normalizedType = normalizeTaskType(rawType);
  var routeKey = identifyRoute(normalizedType);

  var result = {
    tools: [],
    route: routeKey,
    taskType: normalizedType,
    reason: ''
  };

  // Caso 1: Rota identificada → retorna preferredTools
  if (routeKey) {
    var route = config.taskRouting[routeKey];
    var preferredTools = route.preferredTools || [];

    // Filtra tools por complexityMax
    var availableTools = preferredTools.filter(function(toolName) {
      var toolInfo = TOOL_CATALOG[toolName];
      if (!toolInfo) return false;
      return complexityNum <= toolInfo.complexityMax;
    });

    // Filtra por restrições de role
    var role = options.role || null;

    if (route.allowRestricted === false) {
      // Rota não permite ferramentas restritas → remove todas
      availableTools = availableTools.filter(function(toolName) {
        return !TOOL_CATALOG[toolName] || !TOOL_CATALOG[toolName].restricted;
      });
    } else if (route.minRole && role) {
      // Rota requer role mínimo → verifica permissão
      var allowedRoles = config.settings.restrictedRoles || [];
      var hasPermission = allowedRoles.some(function(r) { return role.indexOf(r) !== -1; });
      if (!hasPermission) {
        // Role não autorizada → remove ferramentas restritas da lista
        // mas ainda retorna as não-restritas
        availableTools = availableTools.filter(function(toolName) {
          return !TOOL_CATALOG[toolName] || !TOOL_CATALOG[toolName].restricted;
        });
      }
    }
    // Se role não foi informado, exibe todas as ferramentas (incluindo restritas)
    // para o chamador decidir a autorização

    result.tools = availableTools.map(function(toolName) {
      var info = TOOL_CATALOG[toolName];
      return {
        name: info.name,
        category: info.category,
        description: info.description,
        restricted: info.restricted
      };
    });

    // Limita a maxToolsPerRoute
    var maxTools = config.settings.maxToolsPerRoute || 5;
    if (result.tools.length > maxTools) {
      result.tools = result.tools.slice(0, maxTools);
    }

    result.reason = 'Rota "' + routeKey + '" identificada para taskType "' + normalizedType + '"';
    return result;
  }

  // Caso 2: Sem rota → busca no catálogo por taskType match
  var toolNames = Object.keys(TOOL_CATALOG);
  var matchedTools = [];

  toolNames.forEach(function(toolName) {
    var tool = TOOL_CATALOG[toolName];
    var matchesType = tool.taskTypes.some(function(tt) {
      return tt === normalizedType || tt === rawType.toLowerCase();
    });
    if (matchesType && complexityNum <= tool.complexityMax) {
      matchedTools.push({
        name: tool.name,
        category: tool.category,
        description: tool.description,
        restricted: tool.restricted
      });
    }
  });

  if (matchedTools.length > 0) {
    result.tools = matchedTools;
    result.reason = 'Match direto no catálogo para taskType "' + normalizedType + '"';
    return result;
  }

  // Caso 3: Fallback — ferramentas da categoria padrão (leitura)
  var defaultCat = config.settings.defaultCategory || 'leitura';
  var defaultTools = toolNames
    .filter(function(toolName) {
      return TOOL_CATALOG[toolName].category === defaultCat;
    })
    .map(function(toolName) {
      var tool = TOOL_CATALOG[toolName];
      return {
        name: tool.name,
        category: tool.category,
        description: tool.description,
        restricted: tool.restricted
      };
    });

  result.tools = defaultTools;
  result.reason = 'Fallback para categoria "' + defaultCat + '" — taskType "' + normalizedType + '" não mapeado';
  return result;
}

/**
 * Roteamento completo de uma descrição de tarefa para ferramentas.
 * Analisa a descrição textual, extrai taskType e complexidade,
 * e retorna as ferramentas recomendadas com justificativa.
 *
 * @param {string} taskDescription - Descrição textual da tarefa
 * @param {Object} [options] - Opções adicionais
 * @param {string} [options.role] - Role do agente
 * @param {number} [options.complexity] - Complexidade override
 * @returns {{
 *   tools: Array,
 *   route: string|null,
 *   taskType: string,
 *   complexity: number,
 *   reason: string,
 *   summary: string
 * }}
 */
function routeTask(taskDescription, options) {
  options = options || {};

  if (!taskDescription || typeof taskDescription !== 'string' || taskDescription.trim().length === 0) {
    return {
      tools: listTools('leitura').slice(0, 3),
      route: null,
      taskType: 'unknown',
      complexity: 1,
      reason: 'Descrição vazia — fallback para leitura',
      summary: '⚠️ Descrição vazia. Ferramentas de leitura sugeridas.'
    };
  }

  var desc = taskDescription.toLowerCase().trim();

  // Extrai taskType da descrição
  var taskType = 'unknown';
  var config = getConfig();

  // Tenta match com cada rota
  var routes = config.taskRouting;
  var routeKeys = Object.keys(routes);
  var bestRoute = null;
  var bestScore = 0;

  routeKeys.forEach(function(routeKey) {
    var route = routes[routeKey];
    var typeList = route.taskTypes || [];
    typeList.forEach(function(type) {
      // Pontua baseado em ocorrência na descrição
      var score = 0;
      if (desc.indexOf(type) !== -1) {
        // Match exato de palavra (com boundaries aproximados)
        score = type.length;
        // Bônus se for a primeira palavra ou palavra-chave forte
        if (desc.startsWith(type)) score += 5;
        if (desc.indexOf(' ' + type + ' ') !== -1) score += 3;
        if (desc.endsWith(type)) score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRoute = routeKey;
        taskType = type;
      }
    });
  });

  // Se não encontrou na descrição, tenta match com palavras-chave
  if (bestScore === 0) {
    var keywords = {
      'criar': 'create',
      'modificar': 'edit',
      'deletar': 'delete',
      'ler': 'read',
      'executar': 'execute',
      'buscar': 'research',
      'pesquisar': 'research',
      'delegar': 'delegate',
      'instalar': 'install',
      'deploy': 'deploy',
      'testar': 'test',
      'commit': 'commit'
    };

    var kwKeys = Object.keys(keywords);
    for (var i = 0; i < kwKeys.length; i++) {
      if (desc.indexOf(kwKeys[i]) !== -1) {
        taskType = keywords[kwKeys[i]];
        break;
      }
    }
  }

  // Determina complexidade
  var complexity = options.complexity || 1;
  if (!options.complexity) {
    // Heurística: palavras como "complexo", "difícil", "grande" aumentam
    if (desc.indexOf('complexo') !== -1 || desc.indexOf('dificil') !== -1) complexity = 4;
    else if (desc.indexOf('grande') !== -1 || desc.indexOf('multi') !== -1) complexity = 3;
    else if (desc.indexOf('simples') !== -1 || desc.indexOf('rapido') !== -1) complexity = 1;
  }

  // Obtém ferramentas
  var toolsResult = getTools(taskType, complexity, options);

  return {
    tools: toolsResult.tools,
    route: toolsResult.route || bestRoute,
    taskType: taskType,
    complexity: complexity,
    reason: toolsResult.reason,
    summary: '📋 Tarefa: "' + taskDescription.substring(0, 60) + (taskDescription.length > 60 ? '...' : '') + '"' +
      '\n   Tipo: ' + taskType + ' | Complexidade: ' + complexity +
      '\n   Rota: ' + (bestRoute || 'fallback') +
      '\n   Ferramentas: ' + toolsResult.tools.map(function(t) { return t.name; }).join(', ')
  };
}

/**
 * Verifica se um agente tem permissão para usar uma ferramenta específica.
 *
 * @param {string} toolName - Nome da ferramenta
 * @param {string} role - Role do agente (ex: 'specialist', 'reader', 'admin')
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkToolPermission(toolName, role) {
  var toolInfo = getToolInfo(toolName);
  if (!toolInfo) {
    return { allowed: false, reason: 'Ferramenta "' + toolName + '" não encontrada' };
  }

  if (!toolInfo.restricted) {
    return { allowed: true, reason: 'Ferramenta não restrita — acesso liberado' };
  }

  var config = getConfig();
  if (!config.settings.enableRestrictions) {
    return { allowed: true, reason: 'Restrições desabilitadas na configuração' };
  }

  if (!role) {
    return { allowed: false, reason: 'Ferramenta "' + toolName + '" requer role de especialista' };
  }

  var allowedRoles = config.settings.restrictedRoles || ['specialist', 'admin', 'senior-developer'];
  var roleLower = role.toLowerCase();

  var isAllowed = allowedRoles.some(function(allowedRole) {
    return roleLower.indexOf(allowedRole) !== -1;
  });

  if (isAllowed) {
    return { allowed: true, reason: 'Role "' + role + '" autorizada para ferramenta "' + toolName + '"' };
  }

  return { allowed: false, reason: 'Role "' + role + '" não autorizada. Requer: ' + allowedRoles.join(', ') };
}

// =====================================================================
//  CLI
// =====================================================================

function printHelp() {
  console.log('');
  console.log(CYAN + BOLD + 'Matrix Tool Router v1.0' + RESET);
  console.log(YELLOW + 'Roteador formal de ferramentas para o pipeline Matrix.' + RESET);
  console.log('');
  console.log('Uso: node tool-router.js <comando> [argumentos]');
  console.log('');
  console.log('Comandos:');
  console.log('  ' + GREEN + 'tools <taskType> [complexity]' + RESET + '  Retorna ferramentas recomendadas');
  console.log('  ' + GREEN + 'info <toolName>' + RESET + '               Informações detalhadas de uma ferramenta');
  console.log('  ' + GREEN + 'list [category]' + RESET + '               Lista ferramentas (opcional: filtrar por categoria)');
  console.log('  ' + GREEN + 'route <taskDescription>' + RESET + '       Roteamento completo de descrição de tarefa');
  console.log('  ' + GREEN + 'categories' + RESET + '                    Lista categorias de ferramentas');
  console.log('  ' + GREEN + 'config' + RESET + '                        Mostra configuração atual');
  console.log('  ' + GREEN + 'reload' + RESET + '                       Recarrega configuração do disco');
  console.log('  ' + GREEN + '--help' + RESET + '                       Exibe esta mensagem');
  console.log('');
  console.log('Categorias de ferramentas:');
  var cats = getToolCategories();
  var catNames = Object.keys(cats);
  catNames.forEach(function(cat) {
    var details = DEFAULT_CONFIG.categories[cat];
    var icon = details ? details.icon : '•';
    console.log('  ' + icon + ' ' + cat + ': ' + cats[cat].length + ' ferramentas');
  });
  console.log('');
  console.log('Exemplos:');
  console.log('  node tool-router.js tools edit');
  console.log('  node tool-router.js tools research 4');
  console.log('  node tool-router.js list leitura');
  console.log('  node tool-router.js info bash');
  console.log('  node tool-router.js route "preciso modificar o arquivo de config"');
  console.log('  node tool-router.js config');
  console.log('');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case '--help':
    case '-h':
      printHelp();
      break;

    case 'tools':
      if (!args[1]) {
        console.error(RED + '❌ Uso: node tool-router.js tools <taskType> [complexity]' + RESET);
        process.exit(1);
      }
      var complexityArg = args[2] ? parseInt(args[2], 10) : 1;
      var toolsResult = getTools(args[1], complexityArg, { role: 'cli' });
      console.log('');
      console.log(CYAN + BOLD + 'Tool Selection' + RESET);
      console.log('  Task type:    ' + args[1]);
      console.log('  Complexity:   ' + complexityArg);
      console.log('  Route:        ' + (toolsResult.route || 'fallback'));
      console.log('  Reason:       ' + toolsResult.reason);
      console.log('');
      console.log(BOLD + 'Ferramentas recomendadas:' + RESET);
      if (toolsResult.tools.length === 0) {
        console.log('  ' + YELLOW + '(nenhuma ferramenta disponível para esta combinação)' + RESET);
      } else {
        toolsResult.tools.forEach(function(t, i) {
          var restrictedMark = t.restricted ? RED + ' 🔒' + RESET : '';
          console.log('  ' + (i + 1) + '. ' + GREEN + t.name + RESET + ' (' + t.category + ')' +
            restrictedMark + ' — ' + t.description);
        });
      }
      console.log('');
      break;

    case 'info':
      if (!args[1]) {
        console.error(RED + '❌ Uso: node tool-router.js info <toolName>' + RESET);
        process.exit(1);
      }
      var info = getToolInfo(args[1]);
      if (!info) {
        console.error(RED + '❌ Ferramenta "' + args[1] + '" não encontrada' + RESET);
        console.log('   Use "node tool-router.js list" para ver todas as ferramentas disponíveis.');
        process.exit(1);
      }
      console.log('');
      console.log(CYAN + BOLD + 'Tool Info: ' + info.name + RESET);
      console.log('  Description:  ' + info.description);
      console.log('  Category:     ' + info.category);
      console.log('  Restricted:   ' + (info.restricted ? RED + 'SIM 🔒' + RESET : GREEN + 'Não' + RESET));
      console.log('  Max complex:  ' + info.complexityMax);
      console.log('  Aliases:      ' + info.aliases.join(', '));
      console.log('  Task types:   ' + info.taskTypes.join(', '));
      console.log('');
      break;

    case 'list':
      var categoryFilter = args[1] || null;
      var tools = listTools(categoryFilter);
      console.log('');
      console.log(CYAN + BOLD + 'Tool Catalog' + RESET + (categoryFilter ? ' (filtro: ' + categoryFilter + ')' : ''));
      console.log('');
      if (tools.length === 0) {
        console.log('  ' + YELLOW + '(nenhuma ferramenta encontrada' + (categoryFilter ? ' na categoria "' + categoryFilter + '"' : '') + ')' + RESET);
      } else {
        tools.forEach(function(t) {
          var restrictedMark = t.restricted ? ' ' + RED + '🔒' + RESET : '';
          console.log('  ' + GREEN + t.name + RESET + restrictedMark);
          console.log('      ' + t.description);
          console.log('      categoria: ' + t.category + ' | max complexity: ' + t.complexityMax);
          console.log('');
        });
        console.log('Total: ' + tools.length + ' ferramentas');
      }
      console.log('');
      break;

    case 'route':
      if (!args[1]) {
        console.error(RED + '❌ Uso: node tool-router.js route <taskDescription>' + RESET);
        process.exit(1);
      }
      var description = args.slice(1).join(' ');
      var routeResult = routeTask(description, { role: 'cli' });
      console.log('');
      console.log(CYAN + BOLD + 'Task Routing' + RESET);
      console.log('');
      console.log(routeResult.summary);
      console.log('');
      console.log(BOLD + 'Ferramentas recomendadas:' + RESET);
      if (routeResult.tools.length === 0) {
        console.log('  ' + YELLOW + '(nenhuma)' + RESET);
      } else {
        routeResult.tools.forEach(function(t, i) {
          var restrictedMark = t.restricted ? ' ' + RED + '🔒' + RESET : '';
          console.log('  ' + (i + 1) + '. ' + GREEN + t.name + RESET + restrictedMark);
        });
      }
      console.log('');
      break;

    case 'categories':
      var cats = getToolCategories();
      console.log('');
      console.log(CYAN + BOLD + 'Tool Categories' + RESET);
      console.log('');
      var catNames = Object.keys(cats);
      catNames.forEach(function(cat) {
        var details = DEFAULT_CONFIG.categories[cat] || {};
        var icon = details.icon || '•';
        var restricted = details.restricted ? ' ' + RED + '🔒' + RESET : '';
        console.log('  ' + icon + ' ' + GREEN + cat + RESET + restricted);
        if (details.description) console.log('      ' + details.description);
        console.log('      ' + cats[cat].length + ' ferramentas: ' +
          cats[cat].map(function(t) { return t.name; }).join(', '));
        console.log('');
      });
      break;

    case 'config':
      var cfg = getConfig();
      console.log('');
      console.log(CYAN + BOLD + 'Tool Router Configuration' + RESET);
      console.log('');
      console.log('Settings:');
      console.log('  defaultCategory:      ' + cfg.settings.defaultCategory);
      console.log('  restrictedByDefault:  ' + cfg.settings.restrictedByDefault);
      console.log('  maxToolsPerRoute:     ' + cfg.settings.maxToolsPerRoute);
      console.log('  enableRestrictions:   ' + cfg.settings.enableRestrictions);
      console.log('  restrictedRoles:      ' + cfg.settings.restrictedRoles.join(', '));
      console.log('');
      console.log('Categories:');
      var catKeys = Object.keys(cfg.categories);
      catKeys.forEach(function(cat) {
        var details = cfg.categories[cat];
        console.log('  ' + (details.icon || '•') + ' ' + cat + ': ' + details.description);
      });
      console.log('');
      console.log('Routing rules: ' + Object.keys(cfg.taskRouting).length);
      var routeKeys = Object.keys(cfg.taskRouting);
      routeKeys.forEach(function(rk) {
        var route = cfg.taskRouting[rk];
        console.log('  ' + rk + ': ' + route.preferredTools.join(', ') + ' [' + route.taskTypes.length + ' types]');
      });
      console.log('');
      console.log('Type synonyms: ' + Object.keys(cfg.typeSynonyms).length);
      console.log('');
      break;

    case 'reload':
      reloadConfig();
      console.log(GREEN + '✓' + RESET + ' Configuração recarregada');
      break;

    default:
      printHelp();
      if (cmd) process.exit(1);
  }
}

module.exports = {
  getTools: getTools,
  getToolInfo: getToolInfo,
  listTools: listTools,
  getToolCategories: getToolCategories,
  routeTask: routeTask,
  checkToolPermission: checkToolPermission,
  getConfig: getConfig,
  reloadConfig: reloadConfig,
  TOOL_CATALOG: TOOL_CATALOG
};
