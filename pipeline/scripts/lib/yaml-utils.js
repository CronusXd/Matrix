/**
 * Matrix YAML Utils v1.0
 * Parser YAML simples com indentação — sem dependências externas.
 * Extraído do rag-index.js (versão mais robusta).
 */

/**
 * Parseia um valor escalar YAML (string, número, booleano, null).
 */
function parseScalar(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * Remove aspas simples ou duplas de um valor string.
 */
function stripQuotes(value) {
  if (typeof value !== 'string') return value;
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Remove comentários inline (#), respeitando strings com aspas.
 */
function stripInlineComment(text) {
  let inSQ = false, inDQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDQ) inSQ = !inSQ;
    else if (ch === '"' && !inSQ) inDQ = !inDQ;
    else if (ch === '#' && !inSQ && !inDQ) {
      return text.substring(0, i).trimEnd();
    }
  }
  return text;
}

/**
 * Obtém o container atual do topo da stack (ou root se vazia).
 */
function getCurrentContainer(stack, root) {
  if (stack.length === 0) return root;
  const frame = stack[stack.length - 1];
  return frame.parentObj[frame.key];
}

/**
 * Parseia YAML simples com indentação.
 *
 * Estratégia: a stack guarda { parentObj, key, indent } onde
 * parentObj[key] é o container sendo construído. Quando encontramos
 * um item de lista (- ), usamos o frame do topo para saber em qual
 * chave do objeto pai adicionar o item.
 */
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    if (trimmed.trim() === '') continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    let content = trimmed.trim();

    // Skip comment-only lines
    if (content.startsWith('#')) continue;

    // Strip inline comments
    content = stripInlineComment(content);

    // Pop stack: enquanto indent <= indent do topo
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    if (content.startsWith('- ')) {
      // ── List item ──────────────────────────────────────────────
      if (stack.length === 0) continue;

      const frame = stack[stack.length - 1];
      const parentObj = frame.parentObj;
      const listKey = frame.key;

      // Ensure it's an array
      if (!Array.isArray(parentObj[listKey])) {
        parentObj[listKey] = [];
      }

      const itemText = content.substring(2).trim();

      // Check if item is "key: value" (object in list)
      const colonIdx = itemText.indexOf(':');
      if (colonIdx > -1 && colonIdx < itemText.length - 1) {
        const ok = itemText.substring(0, colonIdx).trim();
        const ov = itemText.substring(colonIdx + 1).trim();
        const entry = {};
        entry[ok] = parseScalar(ov);
        parentObj[listKey].push(entry);
      } else {
        parentObj[listKey].push(parseScalar(itemText));
      }
    } else if (content.endsWith(':')) {
      // ── Key with children (object) ─────────────────────────────
      const key = content.slice(0, -1).trim();
      const container = getCurrentContainer(stack, root);
      container[key] = {};
      stack.push({ parentObj: container, key, indent });
    } else {
      // ── key: value ─────────────────────────────────────────────
      const colonIdx = content.indexOf(':');
      if (colonIdx === -1) continue;

      const key = content.substring(0, colonIdx).trim();
      let value = content.substring(colonIdx + 1).trim();
      const container = getCurrentContainer(stack, root);

      if (value === '') {
        // Valor vazio — pode ser lista ou objeto nas próximas linhas
        container[key] = {};
        stack.push({ parentObj: container, key, indent });
      } else {
        container[key] = parseScalar(value);
      }
    }
  }

  return root;
}

/**
 * Extrai todas as seções de nível superior de um arquivo YAML.
 * Retorna um array de nomes de seção que aparecem como `name:` no indent 0.
 */
function getTopLevelSections(content) {
  const sections = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
      sections.push(trimmed.slice(0, -1));
    }
  }
  return sections;
}

/**
 * Parseia uma lista YAML de objetos em uma seção específica.
 *
 * Formato esperado:
 * ```yaml
 * sectionName:
 *   - key1: "val1"
 *     key2: "val2"
 *   - key1: "val3"
 * ```
 *
 * @param {string} content - Conteúdo YAML completo
 * @param {string} sectionName - Nome da seção (ex: "states", "transitions")
 * @returns {Array<Object>} Array de objetos parseados
 */
function parseSectionList(content, sectionName) {
  const lines = content.split('\n');
  const items = [];

  let sectionIndent = -1;
  let sectionStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === sectionName + ':') {
      sectionIndent = lines[i].length - lines[i].trimStart().length;
      sectionStartLine = i;
      break;
    }
  }

  if (sectionStartLine === -1) return items;

  let currentItem = null;
  let listItemIndent = -1;

  for (let i = sectionStartLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    // Detecta fim da seção
    if (indent <= sectionIndent && trimmed.endsWith(':')) {
      break;
    }

    if (indent <= sectionIndent) continue;

    // Item de lista: começa com "- "
    if (trimmed.startsWith('- ')) {
      if (listItemIndent === -1) listItemIndent = indent;

      if (currentItem) items.push(currentItem);
      currentItem = {};

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentItem[key] = value;
      }
    } else if (currentItem && indent > listItemIndent) {
      // Propriedade adicional do item atual
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();

        if (value === '') {
          currentItem[key] = [];
          continue;
        }

        value = stripQuotes(value);
        currentItem[key] = value;
      }
    }
  }

  if (currentItem) items.push(currentItem);
  return items;
}

/**
 * Parseia o formato pipeline-spec.yaml que tem `steps` arrays aninhados.
 * Cada teste tem: name, description, steps (array de {from, trigger, expect})
 *
 * @param {string} content - Conteúdo YAML completo do pipeline-spec.yaml
 * @returns {Array<Object>} Array de objetos de teste com steps
 */
function parseTestSpec(content) {
  const lines = content.split('\n');
  const tests = [];

  let testSectionIndent = -1;
  let testSectionStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'tests:') {
      testSectionIndent = lines[i].length - lines[i].trimStart().length;
      testSectionStart = i;
      break;
    }
  }

  if (testSectionStart === -1) return tests;

  let currentTest = null;
  let currentStep = null;
  let inSteps = false;
  let testListItemIndent = -1;
  let stepListItemIndent = -1;
  let stepsPropertyIndent = -1;

  for (let i = testSectionStart + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    // Fim da seção
    if (indent <= testSectionIndent && trimmed.endsWith(':')) {
      break;
    }
    if (indent <= testSectionIndent) continue;

    const isDashItem = trimmed.startsWith('- ');
    const isKeyValue = !isDashItem && trimmed.includes(':');

    // Saindo de steps: novo item de teste no indent de teste
    if (inSteps && isDashItem && indent <= stepsPropertyIndent) {
      if (currentStep) {
        currentTest.steps.push(currentStep);
        currentStep = null;
      }
      inSteps = false;

      if (currentTest && currentTest.steps) {
        tests.push(currentTest);
      }
      currentTest = { steps: [] };
      currentStep = null;

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    // Saindo de steps: linha sem dash no/abaixo do indent de steps
    if (inSteps && !isDashItem && indent <= stepsPropertyIndent && isKeyValue) {
      if (currentStep) {
        currentTest.steps.push(currentStep);
        currentStep = null;
      }
      inSteps = false;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    // Detecta "steps:"
    if (currentTest && !inSteps && trimmed === 'steps:' && indent > testListItemIndent) {
      inSteps = true;
      if (stepsPropertyIndent === -1) stepsPropertyIndent = indent;
      continue;
    }

    // Dentro de steps: itens de step
    if (inSteps && isDashItem && currentTest) {
      if (stepListItemIndent === -1) stepListItemIndent = indent;
      if (currentStep) currentTest.steps.push(currentStep);
      currentStep = {};

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentStep[key] = value;
      }
      continue;
    }

    // Dentro de steps: propriedade de step
    if (inSteps && currentStep && isKeyValue && indent > stepListItemIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentStep[key] = value;
      }
      continue;
    }

    // Itens de lista de teste (fora de steps)
    if (!inSteps && isDashItem) {
      if (testListItemIndent === -1) testListItemIndent = indent;

      if (currentTest && currentTest.steps) {
        tests.push(currentTest);
      }

      currentTest = { steps: [] };
      currentStep = null;

      const rest = trimmed.substring(2).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        const key = rest.substring(0, colonIdx).trim();
        let value = rest.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }

    // Propriedade regular de teste
    if (!inSteps && currentTest && isKeyValue && indent > testListItemIndent) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        let value = trimmed.substring(colonIdx + 1).trim();
        value = stripQuotes(value);
        currentTest[key] = value;
      }
      continue;
    }
  }

  if (currentStep && currentTest) currentTest.steps.push(currentStep);
  if (currentTest && currentTest.steps) tests.push(currentTest);

  return tests;
}

module.exports = { parseYaml, parseScalar, stripInlineComment, stripQuotes, getTopLevelSections, parseSectionList, parseTestSpec };
