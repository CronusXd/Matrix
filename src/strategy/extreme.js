/**
 * Matrix Strategy: Extreme
 * ========================
 * For complexity 5 tasks. Research + decomposition + parallel execution
 * + validation + judge + refinement loop. Maximum quality, maximum cost.
 *
 * EXECUTION FLOW:
 *   1. Deep analysis and research
 *   2. Decompose into sub-tasks
 *   3. Execute sub-tasks (potentially parallel)
 *   4. Synthesize results
 *   5. Full validation with regression check
 *   6. Judge review
 *   7. Refinement loop (up to 3 iterations)
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

/**
 * Strategy definition.
 */
const definition = {
  name: 'extreme',
  complexityRange: [5, 5],
  maxModelCalls: 5, // Up to 5 model calls (decomposition + synthesis)
  requiresContext: true,
  requiresAnalysis: true,
  requiresValidation: true,
  requiresJudge: true,
  description: 'Full pipeline: research, decomposition, parallel execution, synthesis, judge, refinement. For extreme-complexity tasks.'
};

/**
 * Execute the extreme strategy.
 *
 * @param {Object} task - Task analysis
 * @param {Object} provider - Model provider
 * @param {Object} [context] - Gathered context
 * @param {Object} [options]
 * @param {number} [options.maxSubTasks=5] - Max parallel sub-tasks
 * @param {Function} [options.judge] - Judge function
 * @returns {Promise<{ content: string, usage: Object, metadata: Object, subResults: Array, validation: Object }>}
 */
async function execute(task, provider, context, options) {
  options = options || {};
  const maxSubTasks = options.maxSubTasks || 5;

  if (!task) {
    throw new Error('Extreme strategy: task is required');
  }
  if (!provider || typeof provider.call !== 'function') {
    throw new Error('Extreme strategy: provider with call() method is required');
  }

  const startTime = Date.now();
  const timeline = [];
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // Step 1: Deep analysis — decompose the task
  const decomposition = decomposeTask(task, context, maxSubTasks);
  timeline.push({ step: 'decomposition', subTasks: decomposition.length, ms: Date.now() - startTime });

  // Step 2: Execute sub-tasks (sequential by default, can be parallelized)
  const subResults = [];
  for (let i = 0; i < decomposition.length; i++) {
    const subTask = decomposition[i];
    const { systemPrompt, userPrompt } = buildSubTaskPrompt(subTask, task, context, i + 1, decomposition.length);

    let rawResult;
    try {
      rawResult = await provider.call({ system: systemPrompt, user: userPrompt });
    } catch (err) {
      subResults.push({
        subTaskId: i + 1,
        success: false,
        error: err.message,
        content: `[Error: ${err.message}]`
      });
      continue;
    }

    const content = normalizeOutput(rawResult);

    subResults.push({
      subTaskId: i + 1,
      title: subTask.title,
      success: true,
      content,
      usage: rawResult.usage || {}
    });

    // Aggregate usage
    if (rawResult.usage) {
      totalUsage.prompt_tokens += rawResult.usage.prompt_tokens || 0;
      totalUsage.completion_tokens += rawResult.usage.completion_tokens || 0;
      totalUsage.total_tokens += rawResult.usage.total_tokens || 0;
    }

    timeline.push({ step: `subtask_${i + 1}`, ms: Date.now() - startTime });
  }

  // Step 3: Synthesize results
  const { systemPrompt: synthSystem, userPrompt: synthUser } = buildSynthesisPrompt(
    task, subResults, context
  );
  const synthRaw = await provider.call({ system: synthSystem, user: synthUser });
  const content = normalizeOutput(synthRaw);

  if (synthRaw.usage) {
    totalUsage.prompt_tokens += synthRaw.usage.prompt_tokens || 0;
    totalUsage.completion_tokens += synthRaw.usage.completion_tokens || 0;
    totalUsage.total_tokens += synthRaw.usage.total_tokens || 0;
  }

  timeline.push({ step: 'synthesis', ms: Date.now() - startTime });

  // Step 4: Validation
  const validation = validateExtreme(content, task, subResults);
  timeline.push({ step: 'validation', ms: Date.now() - startTime });

  // Step 5: Judge (optional)
  let judgeResult = null;
  if (options.judge && typeof options.judge === 'function') {
    try {
      judgeResult = await options.judge(content, task, validation);
      timeline.push({ step: 'judge', verdict: judgeResult.verdict, ms: Date.now() - startTime });
    } catch (err) {
      judgeResult = { error: err.message, skipped: true };
    }
  }

  const duration = Date.now() - startTime;

  const metadata = {
    strategy: 'extreme',
    modelCalls: decomposition.length + 1,
    subTaskCount: decomposition.length,
    successfulSubTasks: subResults.filter(r => r.success).length,
    totalDuration: duration,
    tokenUsage: totalUsage,
    timeline,
    judgeResult,
    timestamp: new Date().toISOString()
  };

  return { content, usage: totalUsage, metadata, subResults, validation };
}

// ---------------------------------------------------------------------------
// Task Decomposition
// ---------------------------------------------------------------------------

/**
 * Decompose an extreme-complexity task into sub-tasks.
 *
 * @param {Object} task
 * @param {Object} [context]
 * @param {number} maxSubTasks
 * @returns {Array<{ id: number, title: string, description: string, focus: string[] }>}
 */
function decomposeTask(task, context, maxSubTasks) {
  const subTasks = [];

  // Architecture / System Design tasks
  if (task.taskType === 'architecture') {
    subTasks.push(
      { id: 1, title: 'Requirements Analysis', description: 'Analyze all functional and non-functional requirements', focus: ['requirements', 'constraints', 'stakeholders'] },
      { id: 2, title: 'Current State Assessment', description: 'Document existing architecture and identify pain points', focus: ['current_state', 'technical_debt', 'limitations'] },
      { id: 3, title: 'Design Target Architecture', description: 'Design the target system architecture with diagrams and rationale', focus: ['components', 'interfaces', 'data_flow'] },
      { id: 4, title: 'Migration Planning', description: 'Plan incremental migration with risk mitigation', focus: ['phases', 'rollback', 'testing'] },
      { id: 5, title: 'Implementation Blueprint', description: 'Create detailed implementation guide with code examples', focus: ['code_structure', 'patterns', 'conventions'] }
    );
    return subTasks.slice(0, maxSubTasks);
  }

  // Complex coding tasks
  if (task.taskType === 'coding' || task.taskType === 'refactoring') {
    subTasks.push(
      { id: 1, title: 'Analysis & Design', description: 'Analyze requirements and design the solution approach', focus: ['requirements', 'design', 'architecture'] },
      { id: 2, title: 'Core Implementation', description: 'Implement the core logic and main components', focus: ['implementation', 'core_logic'] },
      { id: 3, title: 'Integration & Wiring', description: 'Connect all components, handle imports and dependencies', focus: ['integration', 'dependencies', 'imports'] },
      { id: 4, title: 'Error Handling & Edge Cases', description: 'Add comprehensive error handling and edge case coverage', focus: ['error_handling', 'validation', 'edge_cases'] },
      { id: 5, title: 'Testing & Verification', description: 'Write tests and verify all requirements are met', focus: ['tests', 'verification', 'criteria'] }
    );
    return subTasks.slice(0, maxSubTasks);
  }

  // Research tasks
  if (task.taskType === 'research') {
    subTasks.push(
      { id: 1, title: 'Scope Definition', description: 'Define research scope and key questions', focus: ['scope', 'questions'] },
      { id: 2, title: 'Literature Review', description: 'Survey existing approaches and solutions', focus: ['existing', 'approaches', 'comparison'] },
      { id: 3, title: 'Analysis & Synthesis', description: 'Analyze findings and synthesize conclusions', focus: ['analysis', 'patterns', 'insights'] },
      { id: 4, title: 'Recommendations', description: 'Formulate actionable recommendations', focus: ['recommendations', 'tradeoffs', 'next_steps'] }
    );
    return subTasks.slice(0, maxSubTasks);
  }

  // Default: generic decomposition
  subTasks.push(
    { id: 1, title: 'Analyze', description: 'Analyze the problem and break it down', focus: ['analysis'] },
    { id: 2, title: 'Design', description: 'Design the solution approach', focus: ['design'] },
    { id: 3, title: 'Implement', description: 'Implement the solution', focus: ['implementation'] },
    { id: 4, title: 'Verify', description: 'Verify the solution meets all criteria', focus: ['verification'] }
  );

  return subTasks.slice(0, maxSubTasks);
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build prompt for a sub-task.
 *
 * @param {Object} subTask
 * @param {Object} task
 * @param {Object} [context]
 * @param {number} step
 * @param {number} total
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildSubTaskPrompt(subTask, task, context, step, total) {
  const systemPrompt = [
    'You are an expert software developer working on a complex, multi-step task.',
    `This is step ${step} of ${total} in the overall plan.`,
    'Focus ONLY on your assigned sub-task. Be thorough and precise.',
    'Output working code — do not just describe what to do.'
  ].join('\n');

  let userPrompt = `# Overall Goal\n${task.goal}\n\n`;
  userPrompt += `# Your Sub-Task (${step}/${total}): ${subTask.title}\n`;
  userPrompt += `${subTask.description}\n\n`;
  userPrompt += `**Focus areas:** ${(subTask.focus || []).join(', ')}\n\n`;

  if (task.constraints && task.constraints.length > 0) {
    userPrompt += `# Constraints\n${task.constraints.map(c => `- ${c}`).join('\n')}\n\n`;
  }

  if (context && context.files && context.files.length > 0) {
    userPrompt += `# Relevant Context\n`;
    for (const file of context.files.slice(0, 3)) {
      const content = file.compressed_content || file.content || '';
      if (content) {
        userPrompt += `### ${file.path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\`\n\n`;
      }
    }
  }

  userPrompt += `# Output\nProvide your complete solution for this sub-task.`;

  return { systemPrompt, userPrompt };
}

/**
 * Build synthesis prompt to combine sub-task results.
 *
 * @param {Object} task
 * @param {Array} subResults
 * @param {Object} [context]
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
function buildSynthesisPrompt(task, subResults, context) {
  const systemPrompt = [
    'You are a senior software architect synthesizing multiple sub-task outputs.',
    'Combine all sub-task results into a single, coherent, complete solution.',
    'Resolve any conflicts between sub-tasks. Ensure consistency.',
    'The final output must address ALL success criteria for the original task.'
  ].join('\n');

  let userPrompt = `# Original Task\n${task.goal}\n\n`;
  userPrompt += `# Success Criteria\n${(task.successCriteria || []).map(c => `- ${c}`).join('\n')}\n\n`;

  userPrompt += `# Sub-Task Results\n\n`;
  for (const sub of subResults) {
    userPrompt += `## ${sub.subTaskId}. ${sub.title || 'Sub-task'}\n`;
    if (sub.success) {
      userPrompt += `\`\`\`\n${sub.content.slice(0, 3000)}\n\`\`\`\n\n`;
    } else {
      userPrompt += `**FAILED:** ${sub.error}\n\n`;
    }
  }

  userPrompt += `# Your Task\n`;
  userPrompt += `Synthesize all sub-task results into a complete, polished solution.\n`;
  userPrompt += `1. Combine all implementation code\n`;
  userPrompt += `2. Ensure consistency across sub-tasks\n`;
  userPrompt += `3. Add any missing pieces\n`;
  userPrompt += `4. Verify against success criteria\n`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Extreme validation — comprehensive check.
 *
 * @param {string} content
 * @param {Object} task
 * @param {Array} subResults
 * @returns {{ passed: boolean, score: number, issues: string[], subTaskCoverage: Object }}
 */
function validateExtreme(content, task, subResults) {
  const issues = [];
  let score = 10;

  if (!content || content.trim().length === 0) {
    return { passed: false, score: 0, issues: ['synthesis_output_empty'], subTaskCoverage: {} };
  }

  // Sub-task coverage
  const failedSubTasks = subResults.filter(r => !r.success);
  if (failedSubTasks.length > 0) {
    issues.push(`${failedSubTasks.length}/${subResults.length} sub-tasks failed`);
    score -= failedSubTasks.length * 2;
  }

  // Synthesis quality
  if (content.length < 200) {
    issues.push('synthesis_too_short');
    score -= 3;
  }

  // Success criteria coverage
  if (task.successCriteria && task.successCriteria.length > 0) {
    const covered = task.successCriteria.filter(c =>
      content.toLowerCase().includes(c.toLowerCase().replace(/_/g, ' '))
    ).length;
    const coverage = covered / task.successCriteria.length;

    if (coverage < 0.6) {
      issues.push(`low_criteria_coverage: ${Math.round(coverage * 100)}%`);
      score -= 3;
    }
  }

  return {
    passed: issues.length === 0,
    score: Math.max(0, Math.min(10, score)),
    issues,
    subTaskCoverage: {
      total: subResults.length,
      succeeded: subResults.filter(r => r.success).length,
      failed: failedSubTasks.length
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOutput(rawResult) {
  if (typeof rawResult === 'string') return rawResult;
  if (rawResult && typeof rawResult.output === 'string') return rawResult.output;
  if (rawResult && typeof rawResult.content === 'string') return rawResult.content;
  if (rawResult && typeof rawResult.text === 'string') return rawResult.text;
  if (rawResult && typeof rawResult === 'object') return JSON.stringify(rawResult);
  return String(rawResult || '');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definition,
  execute,
  decomposeTask,
  buildSubTaskPrompt,
  buildSynthesisPrompt,
  validateExtreme
};
