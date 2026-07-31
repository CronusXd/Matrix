/**
 * Matrix Prompt Compiler v1.0
 * ============================
 * Transforms raw user messages + context into an optimized prompt.
 * Separates concerns: USER INTENT, GOAL, CONTEXT, CONSTRAINTS,
 * PLAN, TOOLS, OUTPUT FORMAT, VERIFICATION CRITERIA.
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum system prompt length (tokens ≈ chars/4) */
const MAX_SYSTEM_PROMPT_CHARS = 4000;

/** Maximum user prompt length */
const MAX_USER_PROMPT_CHARS = 24000;

/** Section separators for structured prompts */
const SECTION_SEPARATOR = '\n\n---\n\n';

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CompiledPrompt
 * @property {string} systemPrompt - Role, constraints, output format
 * @property {string} userPrompt - Goal + context + plan + verification
 * @property {Array} messages - Full message array for the model
 * @property {number} estimatedTokens - Estimated token count
 * @property {Object} metadata - Compilation metadata
 */

// ---------------------------------------------------------------------------
// Main API: compilePrompt
// ---------------------------------------------------------------------------

/**
 * Compile an optimized prompt from task analysis, context, and strategy.
 *
 * @param {Object} taskAnalysis - Task analysis from task-intelligence.js
 * @param {Object} [context] - Gathered context from context-engine.js
 * @param {Object} [strategy] - Strategy selection from strategy-engine.js
 * @returns {CompiledPrompt}
 */
function compilePrompt(taskAnalysis, context, strategy) {
  if (!taskAnalysis) {
    return _compileFallback('No task analysis provided');
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(strategy, taskAnalysis);

  // Build user prompt
  const userPrompt = buildUserPrompt(taskAnalysis, context, strategy);

  // Estimate tokens
  const estimatedTokens = estimateTokens(systemPrompt, userPrompt);

  // Build message array
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  return {
    systemPrompt,
    userPrompt,
    messages,
    estimatedTokens,
    metadata: {
      strategy: (strategy && strategy.name) || 'unknown',
      taskType: taskAnalysis.taskType,
      complexity: taskAnalysis.complexity,
      hasContext: !!(context && context.files && context.files.length > 0),
      contextFileCount: (context && context.files) ? context.files.length : 0,
      compiledAt: new Date().toISOString()
    }
  };
}

// ---------------------------------------------------------------------------
// System Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt based on strategy and task type.
 *
 * @param {Object} [strategy] - Strategy info
 * @param {Object} taskAnalysis - Task analysis
 * @returns {string} System prompt
 */
function buildSystemPrompt(strategy, taskAnalysis) {
  const sections = [];
  const taskType = (taskAnalysis && taskAnalysis.taskType) || 'coding';
  const strategyName = (strategy && strategy.name) || 'standard';

  // Section 1: Role definition
  sections.push(buildRoleSection(taskType, strategyName));

  // Section 2: Behavioral constraints
  sections.push(buildConstraintsSection(taskAnalysis));

  // Section 3: Output format
  sections.push(buildOutputSection(taskType, strategyName));

  // Section 4: Quality requirements (for deep/extreme strategies)
  if (['deep', 'extreme'].includes(strategyName)) {
    sections.push(buildQualitySection(taskAnalysis));
  }

  const prompt = sections.join(SECTION_SEPARATOR);

  // Enforce max length
  if (prompt.length > MAX_SYSTEM_PROMPT_CHARS) {
    return prompt.slice(0, MAX_SYSTEM_PROMPT_CHARS - 100) +
      '\n// [system prompt truncated for token budget]';
  }

  return prompt;
}

/**
 * Build the role definition section.
 *
 * @param {string} taskType
 * @param {string} strategyName
 * @returns {string}
 */
function buildRoleSection(taskType, strategyName) {
  const roles = {
    coding: 'You are an expert software engineer. Write production-quality, well-tested code.',
    debugging: 'You are an expert debugger. Identify root causes and provide precise fixes.',
    refactoring: 'You are an expert software architect specializing in clean code and refactoring.',
    architecture: 'You are a senior systems architect. Design scalable, maintainable architectures.',
    research: 'You are a research analyst. Provide thorough, evidence-based analysis.',
    planning: 'You are a project planner. Decompose tasks and create actionable plans.',
    reasoning: 'You are a logical reasoning expert. Analyze problems step by step.',
    other: 'You are a helpful AI assistant. Provide accurate, complete responses.'
  };

  let role = roles[taskType] || roles.other;

  // Strategy-specific augmentations
  if (strategyName === 'extreme') {
    role += ' You use a systematic, multi-step approach: analyze, decompose, solve, verify.';
  } else if (strategyName === 'deep') {
    role += ' You plan before acting: analyze requirements, design the solution, then implement.';
  }

  return `## Role\n\n${role}`;
}

/**
 * Build behavioral constraints section.
 *
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildConstraintsSection(taskAnalysis) {
  const rules = [
    'Do NOT include unnecessary explanations or apologies.',
    'Be direct and precise in your responses.',
    'If you are unsure about something, state your assumptions explicitly.',
    'Always provide complete, working solutions — no placeholders or TODOs.',
    'Follow existing project conventions and coding style.'
  ];

  // Task-specific constraints
  if (taskAnalysis) {
    if (taskAnalysis.requiresCodeChanges) {
      rules.push('Write executable code — do not just describe what to do.');
    }

    if (taskAnalysis.taskType === 'debugging') {
      rules.push('Explain the root cause before presenting the fix.');
    }

    if (taskAnalysis.taskType === 'refactoring') {
      rules.push('Preserve existing behavior. Do NOT change functionality unless explicitly requested.');
    }

    if (taskAnalysis.taskType === 'architecture') {
      rules.push('Document trade-offs and alternatives considered.');
    }
  }

  return `## Behavioral Constraints\n\n${rules.map(r => `- ${r}`).join('\n')}`;
}

/**
 * Build output format section.
 *
 * @param {string} taskType
 * @param {string} strategyName
 * @returns {string}
 */
function buildOutputSection(taskType, strategyName) {
  let format;

  switch (taskType) {
    case 'coding':
    case 'debugging':
    case 'refactoring':
      format = [
        'Provide your solution in the following format:',
        '',
        '1. **Analysis** — Brief explanation of the approach',
        '2. **Implementation** — Complete code with all imports',
        '3. **Verification** — How to verify the solution works',
        '',
        'Use markdown code blocks with language identifiers (e.g., ```javascript).',
        'Include ALL necessary code — no references to "existing code" without showing it.'
      ].join('\n');
      break;

    case 'architecture':
      format = [
        'Provide your architecture in the following format:',
        '',
        '1. **Executive Summary** — Key decisions and rationale',
        '2. **Current State** — Existing architecture overview',
        '3. **Target Architecture** — Proposed design with diagrams (ASCII/text)',
        '4. **Component Details** — Each component with responsibilities and interfaces',
        '5. **Data Flow** — How data moves through the system',
        '6. **Trade-offs** — Alternatives considered and why they were rejected',
        '7. **Migration Path** — Incremental steps to reach target state'
      ].join('\n');
      break;

    case 'research':
      format = [
        'Provide your research in the following format:',
        '',
        '1. **Executive Summary** — Key findings in 3-5 bullet points',
        '2. **Methodology** — How you approached the research',
        '3. **Findings** — Detailed results organized by theme',
        '4. **Analysis** — Patterns, insights, and implications',
        '5. **Recommendations** — Actionable next steps',
        '6. **Sources** — References and evidence'
      ].join('\n');
      break;

    case 'planning':
      format = [
        'Provide your plan in the following format:',
        '',
        '1. **Objectives** — What success looks like',
        '2. **Task Breakdown** — Ordered list of tasks with estimates',
        '3. **Dependencies** — What blocks what',
        '4. **Milestones** — Key checkpoints and deliverables',
        '5. **Risks** — Potential blockers and mitigations',
        '6. **Timeline** — Estimated completion schedule'
      ].join('\n');
      break;

    default:
      format = 'Provide a complete, well-structured response. Use clear sections and examples where helpful.';
  }

  return `## Output Format\n\n${format}`;
}

/**
 * Build quality requirements section (for deep/extreme strategies).
 *
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildQualitySection(taskAnalysis) {
  const requirements = [
    'Test all edge cases: null, undefined, empty arrays, boundary values.',
    'Include error handling with meaningful error messages.',
    'Write comments for complex or non-obvious logic.',
    'Ensure backward compatibility with existing code.'
  ];

  if (taskAnalysis && taskAnalysis.constraints) {
    if (taskAnalysis.constraints.includes('quality:requires_tests') ||
        taskAnalysis.constraints.includes('quality:requires_docs')) {
      requirements.push('Include unit tests for all new functionality.');
    }
  }

  return `## Quality Requirements\n\n${requirements.map(r => `- ${r}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// User Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the user prompt from task analysis, context, and strategy.
 *
 * @param {Object} taskAnalysis
 * @param {Object} [context]
 * @param {Object} [strategy]
 * @returns {string}
 */
function buildUserPrompt(taskAnalysis, context, strategy) {
  const sections = [];

  // Section 1: Goal / Task description
  sections.push(`# Task\n\n**Goal:** ${taskAnalysis.goal || '(no goal specified)'}`);
  sections.push(`**Type:** ${taskAnalysis.taskType || 'other'}`);
  sections.push(`**Complexity:** ${taskAnalysis.complexity || '?'}/5`);

  // Section 2: Context (if available)
  if (context && context.files && context.files.length > 0) {
    sections.push(buildContextSection(context, taskAnalysis));
  }

  // Section 3: Constraints
  if (taskAnalysis.constraints && taskAnalysis.constraints.length > 0) {
    sections.push(buildTaskConstraintsSection(taskAnalysis));
  }

  // Section 4: Execution plan (for deep/extreme)
  if (strategy && ['deep', 'extreme'].includes(strategy.name)) {
    sections.push(buildPlanSection(taskAnalysis));
  }

  // Section 5: Tools available
  if (taskAnalysis.requiresTools) {
    sections.push(buildToolsSection());
  }

  // Section 6: Success criteria / Verification
  sections.push(buildVerificationSection(taskAnalysis));

  // Section 7: Final instructions
  sections.push('## Instructions\n\nProvide your complete solution addressing ALL of the above requirements.');

  const prompt = sections.join(SECTION_SEPARATOR);

  // Enforce max length
  if (prompt.length > MAX_USER_PROMPT_CHARS) {
    return prompt.slice(0, MAX_USER_PROMPT_CHARS - 200) +
      '\n\n// [prompt truncated for token budget — prioritize critical sections]';
  }

  return prompt;
}

/**
 * Build context section from gathered files.
 *
 * @param {Object} context
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildContextSection(context, taskAnalysis) {
  const files = context.files || [];

  let section = `## Context Files (${files.length} relevant)\n\n`;

  section += `The following files are relevant to your task. Use them as reference.\n\n`;

  // Limit context to avoid overwhelming the prompt
  const maxContextFiles = taskAnalysis && taskAnalysis.complexity >= 5 ? 15 : 10;
  const displayFiles = files.slice(0, maxContextFiles);

  for (const file of displayFiles) {
    const filePath = file.path || 'unknown';
    const content = file.compressed_content || file.content || '';

    // Deduplicate if content already appears in a prompt section
    if (!content || content.length === 0) continue;

    section += `### ${file.rank || ''}. \`${filePath}\`\n`;
    if (file.reasons && file.reasons.length > 0) {
      section += `_Relevance: ${file.reasons.join(', ')}_\n`;
    }
    section += '\n```\n' + content + '\n```\n\n';
  }

  return section;
}

/**
 * Build task constraints section.
 *
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildTaskConstraintsSection(taskAnalysis) {
  const constraints = taskAnalysis.constraints || [];

  let section = '## Constraints\n\n';
  section += 'You MUST respect the following constraints:\n\n';
  section += constraints.map(c => `- **${formatConstraint(c)}**`).join('\n');

  return section;
}

/**
 * Format a constraint string for display.
 *
 * @param {string} constraint
 * @returns {string}
 */
function formatConstraint(constraint) {
  const labels = {
    'time_sensitive': 'URGENT: Time-sensitive task',
    'scope:minimal': 'Minimal changes only — modify as few files as possible',
    'scope:no_tests': 'Do NOT add or modify tests',
    'quality:requires_tests': 'Tests are REQUIRED for this change',
    'quality:requires_docs': 'Documentation must be updated',
    'compatibility:backward_compatible': 'Must maintain backward compatibility',
    'performance:sensitive': 'Performance is critical — optimize accordingly',
    'security:critical': 'Security is critical — follow best practices strictly'
  };

  if (labels[constraint]) return labels[constraint];

  // Handle prefixed constraints like "platform:react" or "format:json"
  const colonIdx = constraint.indexOf(':');
  if (colonIdx > 0) {
    const category = constraint.slice(0, colonIdx);
    const value = constraint.slice(colonIdx + 1);
    return `${category}: ${value}`;
  }

  return constraint;
}

/**
 * Build execution plan section for deep/extreme strategies.
 *
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildPlanSection(taskAnalysis) {
  const taskType = taskAnalysis.taskType || 'coding';

  let section = '## Suggested Approach\n\n';
  section += 'Consider following this systematic approach:\n\n';

  const steps = generateSuggestedSteps(taskType);

  section += steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  section += '\n\nYou may adapt this plan based on the specifics of the task.';

  return section;
}

/**
 * Generate suggested steps based on task type.
 *
 * @param {string} taskType
 * @returns {string[]}
 */
function generateSuggestedSteps(taskType) {
  switch (taskType) {
    case 'coding':
      return [
        'Analyze the requirements and identify all affected files',
        'Design the solution structure before writing code',
        'Implement the core logic with proper error handling',
        'Handle edge cases: empty inputs, null values, boundary conditions',
        'Verify the solution against all success criteria'
      ];
    case 'debugging':
      return [
        'Reproduce and isolate the bug',
        'Trace through the code to find the root cause',
        'Apply the minimal fix needed',
        'Verify the fix does not introduce new issues',
        'Add regression protection if applicable'
      ];
    case 'refactoring':
      return [
        'Map the current structure and identify pain points',
        'Design the target structure before touching code',
        'Make changes incrementally, one component at a time',
        'Run tests after each change to catch regressions early',
        'Update all references, imports, and documentation'
      ];
    case 'architecture':
      return [
        'Document the current architecture and its limitations',
        'Define clear requirements and constraints for the new design',
        'Design the target architecture with component diagrams',
        'Evaluate trade-offs and document decisions',
        'Plan incremental migration with rollback safety'
      ];
    default:
      return [
        'Analyze the problem thoroughly',
        'Develop a structured solution',
        'Verify against all requirements',
        'Deliver a complete, polished result'
      ];
  }
}

/**
 * Build tools availability section.
 *
 * @returns {string}
 */
function buildToolsSection() {
  return `## Available Tools\n\n` +
    `You have access to the following capabilities:\n\n` +
    `- File system operations (read, write, edit)\n` +
    `- Code execution and testing\n` +
    `- Web search and documentation lookup\n` +
    `- Git operations (diff, log, status)\n\n` +
    `Use these tools proactively to gather information and verify your work.`;
}

/**
 * Build verification section.
 *
 * @param {Object} taskAnalysis
 * @returns {string}
 */
function buildVerificationSection(taskAnalysis) {
  const criteria = taskAnalysis.successCriteria || [];

  let section = '## Verification Criteria\n\n';
  section += 'Your solution will be evaluated against these criteria:\n\n';

  if (criteria.length > 0) {
    section += criteria.map(c => `- [ ] ${formatCriterion(c)}`).join('\n');
  } else {
    section += '- [ ] Task completed successfully and accurately';
  }

  section += '\n\nEnsure your solution satisfies ALL of the above before submission.';

  return section;
}

/**
 * Format a success criterion for display.
 *
 * @param {string} criterion
 * @returns {string}
 */
function formatCriterion(criterion) {
  const labels = {
    'task_completed_successfully': 'Task completed successfully with no errors',
    'code_compiles_without_errors': 'Code compiles/runs without errors',
    'existing_tests_pass': 'All existing tests continue to pass',
    'new_functionality_works_as_expected': 'New functionality works as expected',
    'bug_reproduced_and_fixed': 'Bug is reproduced AND fixed',
    'regression_tests_pass': 'Regression tests pass',
    'root_cause_identified': 'Root cause is clearly identified',
    'behavior_preserved': 'Existing behavior is completely preserved',
    'all_tests_pass': 'All tests pass (existing and new)',
    'code_quality_improved': 'Code quality is measurably improved',
    'no_new_bugs_introduced': 'No new bugs introduced',
    'design_document_complete': 'Design document is complete and clear',
    'tradeoffs_documented': 'Trade-offs are explicitly documented',
    'stakeholder_reviewed': 'Design has been reviewed or is review-ready',
    'sources_cited': 'Sources are properly cited',
    'findings_clear': 'Findings are clearly presented',
    'actionable_conclusions': 'Conclusions are actionable',
    'tasks_decomposed': 'Tasks are decomposed into manageable pieces',
    'estimates_provided': 'Time/resource estimates are provided',
    'dependencies_mapped': 'Dependencies between tasks are mapped',
    'logic_sound': 'Logical reasoning is sound',
    'conclusion_reached': 'A clear conclusion is reached',
    'assumptions_stated': 'All assumptions are explicitly stated',
    'response_accurate': 'Response is factually accurate',
    'response_complete': 'Response is complete and addresses all parts'
  };

  return labels[criterion] || criterion.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate token count (rough: 4 chars ≈ 1 token).
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {number}
 */
function estimateTokens(systemPrompt, userPrompt) {
  return Math.ceil(
    ((systemPrompt || '').length + (userPrompt || '').length) / 4
  );
}

/**
 * Fallback compilation for missing task analysis.
 *
 * @param {string} reason
 * @returns {CompiledPrompt}
 * @private
 */
function _compileFallback(reason) {
  return {
    systemPrompt: 'You are a helpful AI assistant. Provide accurate, complete responses.',
    userPrompt: `Please respond to the user's request. (Compiler note: ${reason})`,
    messages: [
      { role: 'system', content: 'You are a helpful AI assistant. Provide accurate, complete responses.' },
      { role: 'user', content: `Please respond to the user's request. (Compiler note: ${reason})` }
    ],
    estimatedTokens: 100,
    metadata: {
      strategy: 'fallback',
      taskType: 'other',
      complexity: 1,
      hasContext: false,
      contextFileCount: 0,
      compiledAt: new Date().toISOString(),
      reason
    }
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  compilePrompt,
  buildSystemPrompt,
  buildUserPrompt,
  buildRoleSection,
  buildConstraintsSection,
  buildOutputSection,
  buildQualitySection,
  buildContextSection,
  buildTaskConstraintsSection,
  buildPlanSection,
  buildToolsSection,
  buildVerificationSection
};
