// Matrix Fase Mapping v1.0
// Fonte única da verdade para mapeamento estado → fase
// Ambos pipeline-executor.js e test-pipeline-integration.js usam este arquivo

function getFaseFromState(stateId) {
  if (!stateId) return 'unknown';
  var map = {
    // init
    'idle': 'init',
    'identifying': 'init',
    'obligations_created': 'init',
    'obligations_verified': 'init',
    // fase_1
    'fase1_analysis': 'fase_1',
    'todolist_created': 'fase_1',
    // fase_2
    'context_building': 'fase_2',
    'fase2_execution': 'fase_2',
    'fase2_complete': 'fase_2',
    // fase_3
    'fase3_validation': 'fase_3',
    'fase3_approved': 'fase_3',
    'fase3_refuted': 'fase_3',
    // fase_4
    'fase4_review': 'fase_4',
    'fase4_approved': 'fase_4',
    'fase4_changes_needed': 'fase_4',
    // entrega
    'delivery': 'entrega',
    'reporting': 'entrega',
    // final
    'completed': 'final',
    'failed': 'final',
    'escalated': 'final'
  };
  return map[stateId] || 'unknown';
}

module.exports = { getFaseFromState };
