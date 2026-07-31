/**
 * Matrix Feedback Engine v1.0
 * ===========================
 * Transforms failure analysis into structured, actionable feedback.
 * NEVER says "try again" — always provides specific guidance.
 *
 * Produces feedback with:
 *   - Failure category and confidence
 *   - Expected vs actual behavior
 *   - Relevant files and context
 *   - Likely root cause
 *   - Constraints to follow
 *   - Required action with explicit steps
 *   - A modified prompt ready to send
 *
 * CommonJS module. Zero npm dependencies.
 *
 * @version 1.0.0
 */

'use strict';

// ---------------------------------------------------------------------------
// @typedef
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FeedbackResult
 * @property {string} failureCategory - From failure-analyzer.js
 * @property {string} expectedBehavior - What was supposed to happen
 * @property {string} actualBehavior - What actually happened
 * @property {string[]} relevantFiles - Files related to the issue
 * @property {string} likelyCause - Most probable root cause
 * @property {string[]} constraints - Constraints for the retry
 * @property {string} requiredAction - What to do differently
 * @property {string} additionalContext - Extra context to include
 * @property {Object} modifiedPrompt - Corrected prompt for retry
 * @property {Object[]} suggestions - Additional improvement suggestions
 */

// ---------------------------------------------------------------------------
// Main API: generateFeedback
// ---------------------------------------------------------------------------

/**
 * Generate structured feedback from failure analysis.
 *
 * @param {Object} failureAnalysis - From failure-analyzer.js
 * @param {Object} task - Task analysis
 * @param {Object} context - Gathered context
 * @param {Object} previousAttempt - Previous model result
 * @returns {FeedbackResult}
 */
function generateFeedback(failureAnalysis, task, context, previousAttempt) {
  if (!failureAnalysis) {
    return generateFallbackFeedback(task, 'No failure analysis available');
  }

  const category = failureAnalysis.category || 'unknown';

  // Generate each feedback component
  const expectedBehavior = generateExpectedBehavior(task, category);
  const actualBehavior = generateActualBehavior(previousAttempt, failureAnalysis);
  const relevantFiles = extractRelevantFiles(context);
  const likelyCause = failureAnalysis.evidence || failureAnalysis.suggestedFix || 'Unknown cause';
  const constraints = deriveConstraints(category, task);
  const requiredAction = generateRequiredAction(category, task, failureAnalysis);
  const additionalContext = generateAdditionalContext(category, context, task);
  const modifiedPrompt = buildModifiedPrompt(task, context, category, failureAnalysis);
  const suggestions = generateSuggestions(category, task, failureAnalysis);

  return {
    failureCategory: category,
    expectedBehavior,
    actualBehavior,
    relevantFiles,
    likelyCause,
    constraints,
    requiredAction,
    additionalContext,
    modifiedPrompt,
    suggestions
  };
}

// ---------------------------------------------------------------------------
// Expected Behavior Generator
// ---------------------------------------------------------------------------

/**
 * Generate expected behavior description based on task type and failure.
 *
 * @param {Object} task
 * @param {string} category
 * @returns {string}
 */
function generateExpectedBehavior(task, category) {
  if (!task) return 'Task should have been completed as described.';

  const typeMap = {
    coding: 'Working, compilable code that implements the requested feature with tests passing.',
    debugging: 'A clear root cause analysis and a minimal fix that resolves the bug without introducing regressions.',
    refactoring: 'Cleaner, more maintainable code that preserves all existing behavior and passes all tests.',
    architecture: 'A well-structured architecture document with clear components, interfaces, and trade-offs documented.',
    research: 'Thorough, evidence-based analysis with actionable conclusions and cited sources.',
    planning: 'A detailed, actionable plan with decomposed tasks, estimates, dependencies, and milestones.',
    reasoning: 'Sound logical reasoning that leads to a clear, well-supported conclusion.',
    other: 'An accurate and complete response to the task requirements.'
  };

  return typeMap[task.taskType] || typeMap.other;
}

// ---------------------------------------------------------------------------
// Actual Behavior Generator
// ---------------------------------------------------------------------------

/**
 * Generate actual behavior description from the previous attempt.
 *
 * @param {Object} previousAttempt
 * @param {Object} failureAnalysis
 * @returns {string}
 */
function generateActualBehavior(previousAttempt, failureAnalysis) {
  const parts = [];

  if (!previousAttempt) {
    return 'No previous attempt to analyze.';
  }

  // Check for empty output
  const content = extractContent(previousAttempt);
  if (!content || content.trim().length === 0) {
    return 'The model produced an empty response.';
  }

  // Check for refusal
  if (/\b(i cannot|i'm unable|i am unable|i don't have|cannot assist)\b/i.test(content)) {
    return `The model refused to complete the task. Response: "${content.slice(0, 200)}"`;
  }

  // Length issues
  if (content.length < 100) {
    parts.push(`Model produced a very short response (${content.length} chars).`);
  }

  // Category-specific actual behaviors
  const category = failureAnalysis ? failureAnalysis.category : '';

  switch (category) {
    case 'execution_failure':
      parts.push('The produced code failed to compile or pass tests.');
      break;
    case 'bad_context':
      parts.push('The model used incorrect or incomplete context to generate the response.');
      break;
    case 'missing_context':
      parts.push('The model attempted to solve the task without sufficient context.');
      break;
    case 'bad_plan':
      parts.push('The model followed a plan but the result did not meet the success criteria.');
      break;
    case 'model_reasoning_failure':
      parts.push('The model produced a response that does not address the task requirements.');
      break;
    default:
      parts.push(`The output did not meet quality standards.`);
  }

  // Add a snippet
  const snippet = content.length > 150
    ? content.slice(0, 150) + '...'
    : content;
  parts.push(`Output preview: "${snippet}"`);

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Required Action Generator
// ---------------------------------------------------------------------------

/**
 * Generate required action — specific, actionable instructions.
 *
 * @param {string} category
 * @param {Object} task
 * @param {Object} failureAnalysis
 * @returns {string}
 */
function generateRequiredAction(category, task, failureAnalysis) {
  const taskType = task ? task.taskType : 'other';

  switch (category) {
    case 'model_reasoning_failure':
      return [
        '1. Review the task goal carefully: ' + (task ? task.goal : 'unknown'),
        '2. Break the task into explicit, numbered steps',
        '3. Address EACH step sequentially in your response',
        '4. Include ALL code, imports, and error handling',
        '5. Verify your output against each success criterion before submitting'
      ].join('\n');

    case 'execution_failure':
      return [
        '1. Check for syntax errors or missing imports',
        '2. Ensure all referenced functions and modules exist',
        '3. Run the code mentally to verify correctness',
        '4. Add explicit error handling for edge cases',
        '5. If modifying existing code, ensure backward compatibility'
      ].join('\n');

    case 'bad_context':
    case 'missing_context':
      return [
        '1. Review the provided context files carefully',
        '2. Only use information present in the context',
        '3. If critical information is missing, state your assumptions',
        '4. Reference specific files and line numbers in your solution',
        '5. Do not fabricate APIs, functions, or structures not in the context'
      ].join('\n');

    case 'context_noise':
      return [
        '1. Focus ONLY on files directly relevant to the task',
        '2. Ignore configuration files, documentation, and unrelated modules',
        '3. Identify the 2-3 most important files and work from those'
      ].join('\n');

    case 'bad_plan':
      return [
        '1. Verify each success criterion is addressed',
        '2. Add explicit checks for each requirement',
        '3. Test the solution against edge cases mentioned in the criteria',
        '4. Ensure the output format matches what was requested'
      ].join('\n');

    case 'bad_decomposition':
      return [
        '1. Reduce the level of decomposition',
        '2. Focus on delivering a complete, working solution',
        '3. Merge related sub-tasks into cohesive sections'
      ].join('\n');

    case 'requirement_ambiguity':
      return [
        '1. State your understanding of the task before proceeding',
        '2. List any assumptions you are making',
        '3. If the task is ambiguous, ask clarifying questions in your response'
      ].join('\n');

    case 'tool_failure':
    case 'environment_failure':
      return [
        '1. Verify your solution does not depend on unavailable tools',
        '2. Use only standard language features and common libraries',
        '3. Include fallback logic for any external dependencies'
      ].join('\n');

    default:
      return [
        '1. Carefully re-read the task requirements',
        '2. Ensure your response is complete and addresses all criteria',
        '3. Double-check your work before submitting'
      ].join('\n');
  }
}

// ---------------------------------------------------------------------------
// Constraint Derivation
// ---------------------------------------------------------------------------

/**
 * Derive constraints for the retry based on the failure.
 *
 * @param {string} category
 * @param {Object} task
 * @returns {string[]}
 */
function deriveConstraints(category, task) {
  const constraints = [];

  // Always present constraints
  constraints.push('do_not_repeat_the_same_mistake');
  constraints.push('address_all_success_criteria');

  // Category-specific
  switch (category) {
    case 'model_reasoning_failure':
      constraints.push('be_explicit_in_every_step');
      constraints.push('include_complete_code');
      break;
    case 'execution_failure':
      constraints.push('ensure_code_compiles');
      constraints.push('verify_all_imports_exist');
      break;
    case 'bad_context':
      constraints.push('only_use_provided_context');
      constraints.push('do_not_fabricate_information');
      break;
    case 'context_noise':
      constraints.push('focus_only_on_relevant_files');
      break;
    case 'bad_plan':
      constraints.push('verify_each_criterion_explicitly');
      break;
    default:
      constraints.push('follow_instructions_precisely');
  }

  // Task-specific constraints
  if (task && task.taskType === 'refactoring') {
    constraints.push('preserve_all_existing_behavior');
    constraints.push('do_not_change_functionality');
  }

  if (task && task.taskType === 'architecture') {
    constraints.push('document_tradeoffs');
    constraints.push('provide_migration_path');
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Additional Context Generator
// ---------------------------------------------------------------------------

/**
 * Generate additional context to include in the retry.
 *
 * @param {string} category
 * @param {Object} context
 * @param {Object} task
 * @returns {string}
 */
function generateAdditionalContext(category, context, task) {
  const parts = ['## Additional Context for Retry\n\n'];

  switch (category) {
    case 'model_reasoning_failure':
      parts.push('The previous attempt failed. You must take a different approach.');
      parts.push('');
      parts.push('**CRITICAL:** Do NOT repeat the previous response. Use a different strategy.');
      break;

    case 'execution_failure':
      parts.push('The previous code failed to compile or pass tests.');
      parts.push('Please double-check syntax, imports, and type correctness.');
      break;

    case 'missing_context':
      parts.push('The task requires context that may not have been available.');
      parts.push('If you need specific information not provided, state it clearly.');
      break;

    case 'bad_plan':
      parts.push('The criteria below were NOT met in the previous attempt:');
      if (task && task.successCriteria) {
        task.successCriteria.forEach(c => {
          parts.push(`- ❌ ${c}`);
        });
      }
      break;

    default:
      parts.push('The previous attempt was insufficient. Please address the issues below:');
      break;
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Modified Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build a modified prompt that avoids repeating the same failure.
 *
 * @param {Object} task
 * @param {Object} context
 * @param {string} category
 * @param {Object} failureAnalysis
 * @returns {Object} { systemPrompt, userPrompt }
 */
function buildModifiedPrompt(task, context, category, failureAnalysis) {
  const suggestions = (failureAnalysis && failureAnalysis.suggestedFix) || '';

  const systemPrompt = [
    'You are an expert developer. Your task has been modified based on previous feedback.',
    '',
    `**Failure Category:** ${category}`,
    `**Previous Issue:** ${suggestions}`,
    '',
    '**CRITICAL INSTRUCTIONS:**',
    '- Take a DIFFERENT approach than what was previously attempted',
    '- Address ALL issues identified in the feedback',
    '- Be thorough and complete — do not skip any section',
    '- If the task requires code, include ALL imports and error handling'
  ].join('\n');

  let userPrompt = '';

  if (task && task.goal) {
    userPrompt += `# Task\n${task.goal}\n\n`;
  }

  userPrompt += `# Feedback on Previous Attempt\n\n`;
  userPrompt += `The previous attempt failed due to: **${category}**\n\n`;
  userPrompt += `**Issue:** ${suggestions}\n\n`;

  // Include success criteria
  if (task && task.successCriteria) {
    userPrompt += `# Success Criteria (must ALL be met)\n\n`;
    task.successCriteria.forEach(c => {
      userPrompt += `- [ ] ${c}\n`;
    });
    userPrompt += '\n';
  }

  // Include relevant context
  if (context && context.files && context.files.length > 0) {
    userPrompt += `# Relevant Files\n\n`;
    for (const file of context.files.slice(0, 5)) {
      const content = file.compressed_content || file.content || '';
      if (content) {
        userPrompt += `### ${file.path || 'unknown'}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\`\n\n`;
      }
    }
  }

  userPrompt += `# Your Task\n`;
  userPrompt += `Provide a COMPLETE solution addressing ALL issues above.\n`;
  userPrompt += `Do NOT repeat the previous approach — use a DIFFERENT strategy.\n`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Suggestions Generator
// ---------------------------------------------------------------------------

/**
 * Generate additional improvement suggestions.
 *
 * @param {string} category
 * @param {Object} task
 * @param {Object} failureAnalysis
 * @returns {Object[]}
 */
function generateSuggestions(category, task, failureAnalysis) {
  const suggestions = [];

  // Universal suggestions
  suggestions.push({
    type: 'process',
    suggestion: 'Consider breaking this task into smaller, independently verifiable chunks.',
    priority: 'medium'
  });

  // Category-specific
  switch (category) {
    case 'model_reasoning_failure':
      suggestions.push({
        type: 'model',
        suggestion: 'Consider using a more capable model for this complexity level.',
        priority: 'high'
      });
      break;
    case 'missing_context':
      suggestions.push({
        type: 'context',
        suggestion: 'Add more specific file patterns and keywords to the context discovery phase.',
        priority: 'high'
      });
      break;
    case 'execution_failure':
      suggestions.push({
        type: 'verification',
        suggestion: 'Add an automated build/test check before considering the task complete.',
        priority: 'high'
      });
      break;
    default:
      break;
  }

  // Task-specific suggestions
  if (task && task.complexity >= 4) {
    suggestions.push({
      type: 'complexity',
      suggestion: 'This is a complex task. Ensure each sub-step is verified before proceeding.',
      priority: 'medium'
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Fallback Feedback
// ---------------------------------------------------------------------------

/**
 * Generate feedback when no failure analysis is available.
 *
 * @param {Object} task
 * @param {string} reason
 * @returns {FeedbackResult}
 */
function generateFallbackFeedback(task, reason) {
  return {
    failureCategory: 'unknown',
    expectedBehavior: 'Task should be completed according to requirements.',
    actualBehavior: `Unable to analyze: ${reason}`,
    relevantFiles: [],
    likelyCause: reason,
    constraints: ['follow_instructions_precisely'],
    requiredAction: 'Re-attempt the task with more explicit instructions.',
    additionalContext: 'Previous analysis unavailable. Please attempt the task from scratch.',
    modifiedPrompt: {
      systemPrompt: 'You are an expert developer. Complete the task as described.',
      userPrompt: task ? task.goal : 'Complete the task.'
    },
    suggestions: [{
      type: 'process',
      suggestion: 'Enable full validation to diagnose the issue.',
      priority: 'high'
    }]
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text content from a result object.
 *
 * @param {Object|string} result
 * @returns {string}
 */
function extractContent(result) {
  if (typeof result === 'string') return result;
  if (!result) return '';
  return result.content || result.output || result.text || JSON.stringify(result);
}

/**
 * Extract relevant file paths from context.
 *
 * @param {Object} context
 * @returns {string[]}
 */
function extractRelevantFiles(context) {
  if (!context || !context.files) return [];
  return context.files
    .filter(f => f && f.path)
    .map(f => f.path)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateFeedback,
  generateFallbackFeedback,
  buildModifiedPrompt,
  deriveConstraints
};
