#!/usr/bin/env node
/**
 * Matrix AI Governance v1.0
 * Políticas de governança para uso de IA no pipeline.
 * Controla quais modelos podem ser usados para quais tarefas,
 * limite de custos, e auditoria de decisões.
 *
 * Uso: node ai-governance.js policy list
 *      node ai-governance.js policy add <taskType> <allowedModel>
 *      node ai-governance.js check <taskType> <model>
 *      node ai-governance.js report
 */
var fs = require('fs');
var path = require('path');

var GOVERNANCE_FILE = path.resolve(__dirname, '..', 'ai-governance.json');

var DEFAULT_POLICIES = {
  version: "1.0",
  policies: [
    { taskType: "code", allowedModels: ["ag/claude-sonnet-4-6", "kr/claude-sonnet-4.5-thinking-agentic"], maxCostPerCall: 0.05 },
    { taskType: "analysis", allowedModels: ["ag/claude-sonnet-4-6", "gc/gemini-2.5-flash"], maxCostPerCall: 0.02 },
    { taskType: "query", allowedModels: ["oc/deepseek-v4-flash-free", "gc/gemini-2.5-flash"], maxCostPerCall: 0.001 },
    { taskType: "security-audit", allowedModels: ["kr/claude-sonnet-4.5-thinking-agentic"], maxCostPerCall: 0.10 },
    { taskType: "architecture-review", allowedModels: ["kr/claude-sonnet-4.5-thinking-agentic", "ag/claude-sonnet-4-6"], maxCostPerCall: 0.08 }
  ],
  rules: {
    maxDailyCost: 5.00,
    maxMonthlyCost: 50.00,
    requireAuditForTypes: ["code", "security-audit", "architecture-review"],
    blockedModels: [],
    allowedUsers: ["*"]  // "*" = todos, ou lista de user IDs
  }
};

function loadPolicies() {
  try {
    if (fs.existsSync(GOVERNANCE_FILE)) {
      return JSON.parse(fs.readFileSync(GOVERNANCE_FILE, 'utf8'));
    }
  } catch(e) {/* use defaults */}
  return JSON.parse(JSON.stringify(DEFAULT_POLICIES));
}

function savePolicies(policies) {
  fs.writeFileSync(GOVERNANCE_FILE, JSON.stringify(policies, null, 2));
}

function checkTaskAllowed(taskType, model) {
  var policies = loadPolicies();
  var policy = null;
  for (var p = 0; p < policies.policies.length; p++) {
    if (policies.policies[p].taskType === taskType) {
      policy = policies.policies[p];
      break;
    }
  }
  if (!policy) return { allowed: true, reason: 'Nenhuma política para ' + taskType };
  if (policy.allowedModels.indexOf(model) === -1) {
    return { allowed: false, reason: 'Modelo ' + model + ' não permitido para ' + taskType + '. Permitidos: ' + policy.allowedModels.join(', ') };
  }
  return { allowed: true, reason: 'OK', maxCost: policy.maxCostPerCall };
}

// CLI
var policies = loadPolicies();
var cmd = process.argv[2];

switch(cmd) {
  case 'policy':
    var sub = process.argv[3];
    if (sub === 'list') {
      console.log('\n📋 AI Governance Policies:');
      for (var p = 0; p < policies.policies.length; p++) {
        var pol = policies.policies[p];
        console.log('  ' + pol.taskType + ':');
        console.log('    Modelos: ' + pol.allowedModels.join(', '));
        console.log('    Max cost: $' + pol.maxCostPerCall);
      }
      console.log('\n  Regras Globais:');
      console.log('    Max diário: $' + policies.rules.maxDailyCost);
      console.log('    Max mensal: $' + policies.rules.maxMonthlyCost);
      console.log('    Audit required: ' + policies.rules.requireAuditForTypes.join(', '));
    } else if (sub === 'add') {
      var taskType = process.argv[4];
      var model = process.argv[5];
      if (!taskType || !model) { console.error('Uso: node ai-governance.js policy add <taskType> <model>'); break; }
      var existing = null;
      for (var x = 0; x < policies.policies.length; x++) {
        if (policies.policies[x].taskType === taskType) {
          existing = policies.policies[x];
          break;
        }
      }
      if (existing) {
        if (existing.allowedModels.indexOf(model) === -1) existing.allowedModels.push(model);
      } else {
        policies.policies.push({ taskType: taskType, allowedModels: [model], maxCostPerCall: 0.01 });
      }
      savePolicies(policies);
      console.log('✅ Política adicionada: ' + taskType + ' → ' + model);
    }
    break;
  case 'check':
    var taskType = process.argv[3];
    var model = process.argv[4];
    if (!taskType || !model) { console.error('Uso: node ai-governance.js check <taskType> <model>'); break; }
    var result = checkTaskAllowed(taskType, model);
    console.log(result.allowed ? '✅ Permitido' : '❌ ' + result.reason);
    break;
  case 'report':
    console.log('\n📊 AI Governance Report');
    console.log('  Políticas: ' + policies.policies.length);
    console.log('  Tipos auditados: ' + policies.rules.requireAuditForTypes.join(', '));
    console.log('  Limite diário: $' + policies.rules.maxDailyCost);
    console.log('  Limite mensal: $' + policies.rules.maxMonthlyCost);
    break;
  default:
    console.log('Uso: node ai-governance.js policy list|add <taskType> <model> | check <taskType> <model> | report');
}

module.exports = { loadPolicies, checkTaskAllowed };
