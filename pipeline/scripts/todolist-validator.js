#!/usr/bin/env node
/**
 * todolist-validator.js — Matrix Todolist Validator v2.0
 *
 * Valida a todolist (saida do @fable-method-agent na Fase 1) contra:
 *   1. JSON Schema estrutural
 *   2. Catalogo de especialistas (Agent Router)
 *   3. DAG de dependencias (ciclos)
 *   4. Existencia dos arquivos em files_to_touch
 *
 * Uso:
 *   node todolist-validator.js <caminho-para-todolist.json>
 *   node todolist-validator.js --watch              (modo monitor)
 *   node todolist-validator.js --schema              (exibe schema info)
 *
 * API:
 *   const { TodolistValidator } = require('./todolist-validator');
 *   const validator = new TodolistValidator(agentRouter);
 *   const result = validator.validate(todolistObject);
 *
 * @license MIT
 */

const fs = require('fs');
const path = require('path');

// ─── Tenta carregar AJV para validacao schema-full ─────────────────────
let Ajv;
try {
  Ajv = require('ajv');
} catch {
  // AJV nao disponivel — usaremos validacao manual
}

// ─── SCHEMA EMBARCADO (copia do todolist-schema.json) ──────────────────
const TODOLIST_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "matrix-todolist-schema.json",
  "title": "Matrix Todolist Schema v2.0",
  "description": "Schema estrito para a todolist de implementacao do Matrix. Gerado pelo @fable-method-agent na Fase 1.",
  "type": "object",
  "required": ["pipeline", "fases"],
  "additionalProperties": false,
  "properties": {
    "pipeline": {
      "type": "object",
      "description": "Metadados do pipeline e classificacao da tarefa",
      "required": ["version", "classification", "demanda"],
      "additionalProperties": false,
      "properties": {
        "version": { "type": "string", "const": "2.0", "description": "Versao do schema" },
        "classification": { "type": "string", "enum": ["simple", "medium", "complex"], "description": "Classificacao deterministica da complexidade" },
        "demanda": { "type": "string", "description": "Descricao original da demanda", "minLength": 1 },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1, "description": "Confianca na classificacao" }
      }
    },
    "fases": {
      "type": "array",
      "description": "Fases da implementacao, executadas em ordem (respeitando depends_on)",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "nome", "especialista", "tasks"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[A-Z]$", "description": "Identificador unico da fase (A-Z)" },
          "nome": { "type": "string", "description": "Nome legivel da fase", "minLength": 2 },
          "descricao": { "type": "string", "description": "Descricao detalhada do objetivo da fase" },
          "especialista": { "type": "string", "pattern": "^@[a-zA-Z0-9_-]+$", "description": "Agente especialista responsavel (ex: @backend-architect)" },
          "files_to_touch": {
            "type": "array",
            "description": "Arquivos que serao modificados nesta fase (para deteccao de scope creep)",
            "items": { "type": "string" },
            "uniqueItems": true
          },
          "depends_on": {
            "type": "array",
            "description": "IDs das fases das quais esta fase depende (DAG)",
            "items": { "type": "string", "pattern": "^[A-Z]$" },
            "uniqueItems": true
          },
          "tasks": {
            "type": "array",
            "description": "Tarefas acionaveis dentro desta fase",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["id", "descricao"],
              "additionalProperties": false,
              "properties": {
                "id": { "type": "string", "description": "Identificador unico da task (ex: A1, A2)" },
                "descricao": { "type": "string", "description": "O que fazer", "minLength": 5 },
                "verification_cmd": { "type": "string", "description": "Comando para verificar (ex: npm test src/X.test.ts)" },
                "expected_outcome": { "type": "string", "description": "Resultado esperado" }
              }
            }
          },
          "verification": { "type": "string", "description": "Criterio de aceitacao da fase" }
        }
      }
    }
  }
};

// ─── TODOLIST VALIDATOR ────────────────────────────────────────────────

class TodolistValidator {
  /**
   * @param {Object} [agentRouter] - Instancia do Agent Router (opcional)
   * @param {Object} [options]
   * @param {boolean} [options.strictMode=true] - Se true, emite erros para warnings
   * @param {string} [options.projectRoot] - Raiz do projeto para resolucao de paths relativos
   */
  constructor(agentRouter, options = {}) {
    this.agentRouter = agentRouter || null;
    this.options = {
      strictMode: options.strictMode !== false,
      projectRoot: options.projectRoot || process.cwd()
    };
  }

  /**
   * Valida a todolist completa.
   * @param {Object} todolist - Objeto da todolist
   * @returns {{ valid: boolean, errors: string[], warnings: string[], stats: Object }}
   */
  validate(todolist) {
    const errors = [];
    const warnings = [];

    // 1. Validacao estrutural (schema)
    const schemaResult = this._validateSchema(todolist);
    errors.push(...schemaResult.errors);
    warnings.push(...schemaResult.warnings);

    // Se ja falhou no schema, para por aqui (evita cascata de erros sem sentido)
    if (errors.length > 0) {
      return this._buildResult(false, errors, warnings, todolist);
    }

    // 2. Validacao de especialistas contra Agent Router
    const agentErrors = [];
    const agentWarnings = [];
    for (const fase of todolist.fases) {
      const result = this._validateAgent(fase);
      agentErrors.push(...result.errors);
      agentWarnings.push(...result.warnings);
    }
    errors.push(...agentErrors);
    warnings.push(...agentWarnings);

    // 3. Validacao DAG (ciclos nas dependencias)
    const dagErrors = this._validateDAG(todolist.fases);
    errors.push(...dagErrors);

    // 4. Validacao de consistencia (files_to_touch vs. tasks)
    const consistencyErrors = this._validateConsistency(todolist.fases);
    errors.push(...consistencyErrors);

    // 5. File existence check (warnings, nao erros — arquivos podem ser criados)
    for (const fase of todolist.fases) {
      if (fase.files_to_touch && Array.isArray(fase.files_to_touch)) {
        for (const file of fase.files_to_touch) {
          const absolutePath = path.resolve(this.options.projectRoot, file);
          if (!fs.existsSync(absolutePath)) {
            if (this.options.strictMode) {
              errors.push(`files_to_touch: "${file}" nao existe no projeto (fase ${fase.id})`);
            } else {
              warnings.push(`files_to_touch: "${file}" nao existe ainda — sera criado (fase ${fase.id})`);
            }
          }
        }
      }
    }

    // 6. IDs duplicados entre fases
    const idSet = new Set();
    for (const fase of todolist.fases) {
      if (idSet.has(fase.id)) {
        errors.push(`Fase com ID duplicado: "${fase.id}"`);
      }
      idSet.add(fase.id);
    }

    // 7. IDs de tasks duplicados dentro de cada fase
    for (const fase of todolist.fases) {
      if (!fase.tasks) continue;
      const taskIdSet = new Set();
      for (const task of fase.tasks) {
        if (taskIdSet.has(task.id)) {
          errors.push(`Task ID duplicado "${task.id}" na fase ${fase.id}`);
        }
        taskIdSet.add(task.id);
      }
    }

    // 8. depends_on referencia IDs que existem
    const faseIds = new Set(todolist.fases.map(f => f.id));
    for (const fase of todolist.fases) {
      if (fase.depends_on && Array.isArray(fase.depends_on)) {
        for (const depId of fase.depends_on) {
          if (!faseIds.has(depId)) {
            errors.push(`Fase ${fase.id} depende de "${depId}" que nao existe`);
          }
        }
      }
    }

    const valid = errors.length === 0;
    return this._buildResult(valid, errors, warnings, todolist);
  }

  /**
   * Valida contra o schema estrutural.
   * Usa AJV se disponivel; caso contrario, fallback manual.
   */
  _validateSchema(todolist) {
    const errors = [];
    const warnings = [];

    // ── Tenta AJV primeiro ──
    if (Ajv) {
      try {
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(TODOLIST_SCHEMA);
        const valid = validate(todolist);
        if (!valid) {
          for (const err of validate.errors) {
            const path = err.instancePath || '';
            errors.push(`Schema[${path}]: ${err.message}`);
          }
        }
        return { errors, warnings };
      } catch (ajvErr) {
        warnings.push(`AJV falhou, fallback para validacao manual: ${ajvErr.message}`);
      }
    }

    // ── Fallback: validacao manual ──
    if (!todolist || typeof todolist !== 'object') {
      errors.push('Todolist deve ser um objeto JSON');
      return { errors, warnings };
    }

    // pipeline
    if (!todolist.pipeline) {
      errors.push('Campo obrigatorio "pipeline" ausente');
    } else {
      if (typeof todolist.pipeline !== 'object') {
        errors.push('"pipeline" deve ser um objeto');
      } else {
        if (!todolist.pipeline.version) errors.push('pipeline.version obrigatorio');
        else if (todolist.pipeline.version !== '2.0') {
          errors.push(`pipeline.version deve ser "2.0", recebeu "${todolist.pipeline.version}"`);
        }
        if (!todolist.pipeline.classification) {
          errors.push('pipeline.classification obrigatorio');
        } else if (!['simple', 'medium', 'complex'].includes(todolist.pipeline.classification)) {
          errors.push(`pipeline.classification deve ser simple|medium|complex, recebeu "${todolist.pipeline.classification}"`);
        }
        if (!todolist.pipeline.demanda) errors.push('pipeline.demanda obrigatorio');
        if (todolist.pipeline.confidence !== undefined) {
          if (typeof todolist.pipeline.confidence !== 'number' ||
              todolist.pipeline.confidence < 0 || todolist.pipeline.confidence > 1) {
            errors.push('pipeline.confidence deve ser um numero entre 0 e 1');
          }
        }
        // Verifica propriedades extras
        const allowedPipelineKeys = ['version', 'classification', 'demanda', 'confidence'];
        for (const key of Object.keys(todolist.pipeline)) {
          if (!allowedPipelineKeys.includes(key)) {
            errors.push(`Propriedade nao permitida em pipeline: "${key}"`);
          }
        }
      }
    }

    // fases
    if (!todolist.fases) {
      errors.push('Campo obrigatorio "fases" ausente');
    } else if (!Array.isArray(todolist.fases)) {
      errors.push('"fases" deve ser um array');
    } else if (todolist.fases.length === 0) {
      errors.push('"fases" deve ter pelo menos 1 fase');
    } else {
      for (let i = 0; i < todolist.fases.length; i++) {
        const f = todolist.fases[i];
        const prefix = `fases[${i}]`;

        if (!f || typeof f !== 'object') {
          errors.push(`${prefix} deve ser um objeto`);
          continue;
        }

        // Campos obrigatorios
        if (!f.id) errors.push(`${prefix}.id obrigatorio`);
        else if (!/^[A-Z]$/.test(f.id)) {
          errors.push(`${prefix}.id deve ser uma unica letra maiuscula (A-Z), recebeu "${f.id}"`);
        }

        if (!f.nome) errors.push(`${prefix}.nome obrigatorio`);
        else if (f.nome.length < 2) errors.push(`${prefix}.nome deve ter pelo menos 2 caracteres`);

        if (!f.especialista) errors.push(`${prefix}.especialista obrigatorio`);
        else if (!/^@[a-zA-Z0-9_-]+$/.test(f.especialista)) {
          errors.push(`${prefix}.especialista deve comecar com @ (ex: @backend-architect)`);
        }

        // tasks
        if (!f.tasks) {
          errors.push(`${prefix}.tasks obrigatorio`);
        } else if (!Array.isArray(f.tasks)) {
          errors.push(`${prefix}.tasks deve ser um array`);
        } else if (f.tasks.length === 0) {
          errors.push(`${prefix}.tasks deve ter pelo menos 1 task`);
        } else {
          for (let j = 0; j < f.tasks.length; j++) {
            const t = f.tasks[j];
            const tPrefix = `${prefix}.tasks[${j}]`;
            if (!t || typeof t !== 'object') {
              errors.push(`${tPrefix} deve ser um objeto`);
              continue;
            }
            if (!t.id) errors.push(`${tPrefix}.id obrigatorio`);
            if (!t.descricao) errors.push(`${tPrefix}.descricao obrigatorio`);
            else if (t.descricao.length < 5) {
              errors.push(`${tPrefix}.descricao deve ter pelo menos 5 caracteres`);
            }
            // Verifica propriedades extras
            const allowedTaskKeys = ['id', 'descricao', 'verification_cmd', 'expected_outcome'];
            for (const key of Object.keys(t)) {
              if (!allowedTaskKeys.includes(key)) {
                errors.push(`Propriedade nao permitida em ${tPrefix}: "${key}"`);
              }
            }
          }
        }

        // files_to_touch
        if (f.files_to_touch !== undefined) {
          if (!Array.isArray(f.files_to_touch)) {
            errors.push(`${prefix}.files_to_touch deve ser um array`);
          } else {
            if (new Set(f.files_to_touch).size !== f.files_to_touch.length) {
              errors.push(`${prefix}.files_to_touch contem valores duplicados`);
            }
          }
        }

        // depends_on
        if (f.depends_on !== undefined) {
          if (!Array.isArray(f.depends_on)) {
            errors.push(`${prefix}.depends_on deve ser um array`);
          } else {
            if (new Set(f.depends_on).size !== f.depends_on.length) {
              errors.push(`${prefix}.depends_on contem valores duplicados`);
            }
            for (let k = 0; k < f.depends_on.length; k++) {
              if (!/^[A-Z]$/.test(f.depends_on[k])) {
                errors.push(`${prefix}.depends_on[${k}] deve ser letra maiuscula (A-Z), recebeu "${f.depends_on[k]}"`);
              }
            }
          }
        }

        // Verifica propriedades extras na fase
        const allowedFaseKeys = [
          'id', 'nome', 'descricao', 'especialista',
          'files_to_touch', 'depends_on', 'tasks', 'verification'
        ];
        for (const key of Object.keys(f)) {
          if (!allowedFaseKeys.includes(key)) {
            errors.push(`Propriedade nao permitida em ${prefix}: "${key}"`);
          }
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Valida se o especialista existe no Agent Router.
   * @param {Object} fase
   * @returns {{ errors: string[], warnings: string[] }}
   */
  _validateAgent(fase) {
    const errors = [];
    const warnings = [];

    if (!fase.especialista || !this.agentRouter) {
      return { errors, warnings };
    }

    // Remove @ do inicio para buscar no catalogo
    const agentName = fase.especialista.replace(/^@/, '');
    const agentInfo = this.agentRouter.getAgentInfo(agentName);

    if (!agentInfo) {
      if (this.options.strictMode) {
        errors.push(`Fase ${fase.id}: especialista "${fase.especialista}" nao encontrado no catalogo do Agent Router`);
      } else {
        warnings.push(`Fase ${fase.id}: especialista "${fase.especialista}" nao encontrado no catalogo do Agent Router`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Valida que as dependencias entre fases formam um DAG valido (sem ciclos).
   * Usa algoritmo de deteccao de ciclos por DFS com coloracao (White-Gray-Black).
   *
   * @param {Array} fases
   * @returns {string[]} Erros encontrados
   */
  _validateDAG(fases) {
    const errors = [];

    // Constroi grafo de adjacencia
    const graph = new Map();
    for (const f of fases) {
      graph.set(f.id, (f.depends_on || []).slice());
    }

    // White-Gray-Black DFS cycle detection
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    for (const f of fases) color.set(f.id, WHITE);

    const cyclePath = [];

    function dfs(node) {
      color.set(node, GRAY);
      cyclePath.push(node);

      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (!color.has(dep)) {
          // Dependencia para ID inexistente — ignorado aqui, validado separadamente
          continue;
        }
        if (color.get(dep) === GRAY) {
          // Encontrou ciclo
          const cycleStart = cyclePath.indexOf(dep);
          const cycle = cyclePath.slice(cycleStart).concat(dep);
          errors.push(`Ciclo detectado nas dependencias: ${cycle.join(' → ')}`);
          return true;
        }
        if (color.get(dep) === WHITE) {
          if (dfs(dep)) return true;
        }
      }

      cyclePath.pop();
      color.set(node, BLACK);
      return false;
    }

    for (const f of fases) {
      if (color.get(f.id) === WHITE) {
        cyclePath.length = 0;
        dfs(f.id);
      }
    }

    return errors;
  }

  /**
   * Validacoes de consistencia entre files_to_touch, tasks e depends_on.
   */
  _validateConsistency(fases) {
    const errors = [];

    for (const fase of fases) {
      // Se tem files_to_touch vazio mas tem tasks, talvez esqueceram de declarar
      if ((!fase.files_to_touch || fase.files_to_touch.length === 0) &&
          fase.tasks && fase.tasks.length > 0) {
        // Apenas warning — pode ser valido se as tasks nao tocam em arquivos
      }

      // Auto-dependencia
      if (fase.depends_on && fase.depends_on.includes(fase.id)) {
        errors.push(`Fase ${fase.id} depende dela mesma (auto-dependencia)`);
      }
    }

    return errors;
  }

  /**
   * Constroi o objeto de resultado.
   */
  _buildResult(valid, errors, warnings, todolist) {
    const fases = todolist.fases || [];
    const allAgentNames = new Set();
    for (const f of fases) {
      if (f.especialista) allAgentNames.add(f.especialista);
    }

    return {
      valid,
      errors,
      warnings,
      stats: {
        total_fases: fases.length,
        total_tasks: fases.reduce((s, f) => s + (f.tasks ? f.tasks.length : 0), 0),
        especialistas: [...allAgentNames].sort(),
        error_count: errors.length,
        warning_count: warnings.length
      },
      verdict: valid ? 'PASS' : (errors.length > 0 ? 'FAIL' : 'PASS_WITH_WARNINGS')
    };
  }

  /**
   * Carrega um arquivo JSON de todolist.
   * @param {string} filePath
   * @returns {Object}
   */
  static loadFromFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Arquivo nao encontrado: ${resolvedPath}`);
    }
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(raw);
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────

function runCLI() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Matrix Todolist Validator v2.0                              ║
║  Valida a todolist contra schema + regras de negocio        ║
╚══════════════════════════════════════════════════════════════╝

Uso:
  node todolist-validator.js <caminho-da-todolist.json>   Validar arquivo
  node todolist-validator.js --schema                     Info do schema
  node todolist-validator.js --help                       Esta mensagem

Exemplos:
  node todolist-validator.js ../todolist.json
  node todolist-validator.js ../todolist.json --strict
`);
    return;
  }

  const fileArg = args.find(a => !a.startsWith('--'));
  const strictMode = args.includes('--strict');

  if (args.includes('--schema')) {
    console.log(JSON.stringify(TODOLIST_SCHEMA, null, 2));
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    runCLI([]);
    return;
  }

  if (!fileArg) {
    console.error('ERRO: Forneca o caminho para o arquivo JSON da todolist');
    process.exit(1);
  }

  // Tenta carregar Agent Router
  let agentRouter = null;
  try {
    agentRouter = require('./agent-router');
  } catch {
    console.warn('[warn] Agent Router nao encontrado, validacao de especialistas desabilitada');
  }

  const validator = new TodolistValidator(agentRouter, { strictMode, projectRoot: path.resolve(__dirname, '..') });

  try {
    const todolist = TodolistValidator.loadFromFile(fileArg);
    const result = validator.validate(todolist);

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Matrix Todolist Validation Report`);
    console.log(`═══════════════════════════════════════════`);
    console.log(`  Verdict:     ${result.verdict === 'PASS' ? '✅ PASS' : result.verdict === 'PASS_WITH_WARNINGS' ? '⚠️  PASS (warnings)' : '❌ FAIL'}`);
    console.log(`  Fases:       ${result.stats.total_fases}`);
    console.log(`  Tasks:       ${result.stats.total_tasks}`);
    console.log(`  Erros:       ${result.stats.error_count}`);
    console.log(`  Warnings:    ${result.stats.warning_count}`);
    console.log(`  Especialistas: ${result.stats.especialistas.join(', ')}`);
    console.log(`───────────────────────────────────────────`);

    if (result.errors.length > 0) {
      console.log(`\n  ❌ ERROS:`);
      for (const err of result.errors) {
        console.log(`    • ${err}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log(`\n  ⚠️  WARNINGS:`);
      for (const warn of result.warnings) {
        console.log(`    • ${warn}`);
      }
    }

    console.log(`───────────────────────────────────────────\n`);

    if (!result.valid) process.exit(1);
  } catch (err) {
    console.error(`\n  ❌ FALHA AO CARREGAR: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── EXPORT ────────────────────────────────────────────────────────────

module.exports = { TodolistValidator, TODOLIST_SCHEMA };

// ─── EXECUCAO DIRETA ───────────────────────────────────────────────────
if (require.main === module) runCLI();
