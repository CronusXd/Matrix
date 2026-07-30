#!/usr/bin/env node
/**
 * Matrix Rollback Manager v1.0
 * Sistema de rollback automático para o pipeline Matrix.
 *
 * Antes de qualquer alteração crítica, cria um snapshot (git stash + branch de backup)
 * e mantém histórico no disco para recuperação segura.
 *
 * Uso:
 *   node rollback-manager.js create <label>    Criar snapshot
 *   node rollback-manager.js list               Listar snapshots
 *   node rollback-manager.js rollback <id>      Restaurar snapshot
 *   node rollback-manager.js cleanup [maxAge]   Limpar snapshots antigos (dias)
 *   node rollback-manager.js --help             Esta mensagem
 *
 * Zero dependências npm.
 */

var fs = require('fs');
var path = require('path');
var exec = require('child_process').execSync;

var BASE_DIR = path.resolve(__dirname, '..', '..');
var PIPELINE_DIR = path.resolve(__dirname, '..');
var SNAPSHOTS_DIR = path.resolve(PIPELINE_DIR, 'snapshots');
var INDEX_FILE = path.resolve(SNAPSHOTS_DIR, 'index.json');
var MAX_LOG_ENTRIES = 100;
var MAX_SNAPSHOTS = 50; // Política: manter no máximo 50 snapshots recentes

// ─── Utilitários ──────────────────────────────────────────────────────────

/**
 * Formata data para nome de arquivo (sem caracteres especiais).
 */
function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Lê o índice de snapshots do disco.
 * @returns {Array}
 */
function readIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('   ⚠️  Erro ao ler index.json:', e.message);
  }
  return [];
}

/**
 * Salva o índice de snapshots no disco.
 * @param {Array} index
 */
function writeIndex(index) {
  try {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  } catch (e) {
    console.error('❌ Erro ao salvar index.json:', e.message);
  }
}

/**
 * Gera um ID único para o snapshot baseado em timestamp.
 * @returns {string}
 */
function generateSnapshotId() {
  return 'hlrn-' + timestampForFilename();
}

/**
 * Executa um comando git e retorna stdout como string.
 * @param {string} cmd
 * @returns {string}
 */
function git(cmd) {
  try {
    return exec('git ' + cmd, { cwd: BASE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    return null;
  }
}

/**
 * Verifica se o diretório é um repositório git.
 * @returns {boolean}
 */
function isGitRepo() {
  var result = git('rev-parse --is-inside-work-tree');
  return result === 'true';
}

/**
 * Obtém o branch atual do git.
 * @returns {string|null}
 */
function getCurrentBranch() {
  return git('rev-parse --abbrev-ref HEAD');
}

/**
 * Obtém o hash do commit atual.
 * @returns {string|null}
 */
function getCurrentCommit() {
  return git('rev-parse HEAD');
}

// ─── Funções Principais ───────────────────────────────────────────────────

/**
 * Cria um snapshot completo antes de qualquer alteração.
 *
 * 1. Registra o estado atual do git (branch + commit)
 * 2. Faz git stash (se houver mudanças não commitadas)
 * 3. Cria branch de backup: matrix-rollback-<timestamp>
 * 4. Salva metadados no diretório snapshots/
 * 5. Atualiza index.json
 *
 * @param {string} label - Descrição do snapshot
 * @returns {{ id: string, label: string, timestamp: string, branch: string, commit: string, backupBranch: string, dir: string, status: string }|null} Objeto com id, branch, commit, dir ou null se falhar
 */
function createSnapshot(label) {
  console.log('');
  console.log('📸 Criando snapshot de rollback...');
  console.log('');

  if (!label) {
    console.error('❌ Erro: informe um label para o snapshot.');
    console.error('   Uso: node rollback-manager.js create "descricao-do-snapshot"');
    return null;
  }

  if (!isGitRepo()) {
    console.error('❌ Erro: diretório não é um repositório git.');
    return null;
  }

  var currentBranch = getCurrentBranch();
  var currentCommit = getCurrentCommit();
  var snapshotId = generateSnapshotId();
  var branchName = 'matrix-rollback-' + snapshotId;
  var ts = new Date().toISOString();
  var snapshotDir = path.join(SNAPSHOTS_DIR, snapshotId);

  console.log('   ID:     ' + snapshotId);
  console.log('   Label:  ' + label);
  console.log('   Branch: ' + currentBranch);
  console.log('   Commit: ' + currentCommit);
  console.log('');

  // 1. Verificar se há mudanças não commitadas — NÃO stash, só avisar
  var hasChanges = git('status --porcelain');
  if (hasChanges && hasChanges.length > 0) {
    console.log('   → ⚠️  Há mudanças não commitadas. Commit recomendado antes do snapshot.');
    console.log('   → A branch de backup ' + branchName + ' será criada no commit atual.');
    // Não faz stash — alterações não commitadas são preservadas.
    // O snapshot de rollback registrará o git diff se disponível.
  } else {
    console.log('   → Nenhuma mudança não commitada');
  }

  // 2. Criar branch de backup
  console.log('   → git branch ' + branchName + ' (backup em ' + currentCommit + ')...');
  var branchResult = git('branch ' + branchName);
  if (branchResult === null) {
    console.error('   ⚠️  Falha ao criar branch de backup. Verifique se o nome já existe.');
  } else {
    console.log('   ✓ Branch criada: ' + branchName);
  }

  // 3. Criar diretório do snapshot
  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
  } catch (e) {
    console.error('❌ Erro ao criar diretório do snapshot:', e.message);
    return null;
  }

  // 4. Copiar state.json, events.log, metrics.json para o snapshot
  var filesToCopy = ['state.json', 'events.log', 'metrics.json', 'todolist.json'];
  filesToCopy.forEach(function (file) {
    var src = path.join(PIPELINE_DIR, file);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(snapshotDir, file));
        console.log('   ✓ ' + file + ' copiado');
      }
    } catch (e) {
      console.log('   ⚠️  Erro ao copiar ' + file + ': ' + e.message);
    }
  });

  // 5. Criar metadata.txt
  var metadata =
    'Snapshot ID: ' + snapshotId + '\n' +
    'Label: ' + label + '\n' +
    'Timestamp: ' + ts + '\n' +
    'Branch: ' + currentBranch + '\n' +
    'Commit: ' + currentCommit + '\n' +
    'Backup Branch: ' + branchName + '\n' +
    'Criado em: ' + ts + '\n';

  try {
    fs.writeFileSync(path.join(snapshotDir, 'metadata.txt'), metadata);
    console.log('   ✓ metadata.txt criado');
  } catch (e) {
    console.log('   ⚠️  Erro ao criar metadata.txt:', e.message);
  }

  // 6. Salvar diff se houver mudanças commitadas recentes (últimos 5 commits)
  try {
    var recentLog = git('log --oneline -10');
    if (recentLog) {
      fs.writeFileSync(path.join(snapshotDir, 'recent-commits.txt'), recentLog);
    }
  } catch (e) { /* opcional */ }

  // 7. Política de retenção: máximo 50 snapshots
  var index = readIndex();
  if (index.length >= MAX_SNAPSHOTS) {
    var toRemove = index.length - MAX_SNAPSHOTS + 1;
    var removed = index.splice(0, toRemove);
    removed.forEach(function(oldEntry) {
      // Remove diretório do snapshot antigo
      try {
        if (oldEntry.dir && fs.existsSync(oldEntry.dir)) {
          removeDirectorySync(oldEntry.dir);
          console.log('   → Snapshot antigo removido (limite ' + MAX_SNAPSHOTS + '): ' + oldEntry.id);
        }
      } catch (e) {
        console.log('   ⚠️  Erro ao remover snapshot antigo: ' + e.message);
      }
      // Remove branch de backup antiga
      try {
        if (oldEntry.backupBranch && isGitRepo()) {
          var branchExists = git('branch --list ' + oldEntry.backupBranch);
          if (branchExists) {
            git('branch -D ' + oldEntry.backupBranch);
          }
        }
      } catch (e) {
        // NON-BLOCKING
      }
    });
  }

  // 8. Atualizar index.json
  var entry = {
    id: snapshotId,
    label: label,
    timestamp: ts,
    branch: currentBranch,
    commit: currentCommit,
    backupBranch: branchName,
    dir: snapshotDir,
    status: 'active'
  };
  index.push(entry);

  // Limitar o histórico para MAX_LOG_ENTRIES
  if (index.length > MAX_LOG_ENTRIES) {
    index = index.slice(index.length - MAX_LOG_ENTRIES);
  }
  writeIndex(index);

  console.log('');
  console.log('✅ Snapshot criado com sucesso!');
  console.log('   ID:             ' + snapshotId);
  console.log('   Branch backup:  ' + branchName);
  console.log('   Diretório:      ' + snapshotDir);
  console.log('');

  return entry;
}

/**
 * Restaura o estado a partir de um snapshot.
 *
 * 1. Valida se o snapshot existe
 * 2. Faz checkout da branch de backup
 * 3. Se solicitado, mescla de volta ao branch original
 * 4. Restaura arquivos de estado (state.json, etc.)
 *
 * @param {string} snapshotId - ID do snapshot a restaurar
 * @returns {boolean} true se sucesso, false se falha
 */
function rollback(snapshotId) {
  console.log('');
  console.log('⏪ Rollback para snapshot: ' + snapshotId);
  console.log('');

  if (!isGitRepo()) {
    console.error('❌ Erro: diretório não é um repositório git.');
    return false;
  }

  // Buscar snapshot no índice
  var index = readIndex();
  var entry = null;
  for (var i = 0; i < index.length; i++) {
    if (index[i].id === snapshotId) {
      entry = index[i];
      break;
    }
  }

  if (!entry) {
    console.error('❌ Snapshot não encontrado: ' + snapshotId);
    console.log('');
    console.log('   Snapshots disponíveis:');
    var snapshots = listSnapshots();
    if (snapshots.length === 0) {
      console.log('   (nenhum)');
    } else {
      snapshots.forEach(function (s) {
        console.log('   - ' + s.id + ' (' + s.label + ')');
      });
    }
    return false;
  }

  if (entry.status !== 'active') {
    console.error('❌ Snapshot está com status "' + entry.status + '". Não é possível restaurar.');
    return false;
  }

  var currentBranch = getCurrentBranch();
  var backupBranch = entry.backupBranch;
  var originalBranch = entry.branch;

  console.log('   Snapshot:    ' + entry.label);
  console.log('   Timestamp:   ' + entry.timestamp);
  console.log('   Branch orig: ' + originalBranch);
  console.log('   Branch backup: ' + backupBranch);
  console.log('   Branch atual: ' + currentBranch);
  console.log('');

  // Verificar se a branch de backup ainda existe
  var branchList = git('branch --list ' + backupBranch);
  if (!branchList) {
    console.error('❌ Branch de backup não encontrada: ' + backupBranch);
    console.error('   Pode ter sido deletada manualmente. Rollback manual necessário.');
    return false;
  }

  // Tentar fazer checkout da branch de backup
  console.log('   → git checkout ' + backupBranch + '...');
  var checkoutResult = git('checkout ' + backupBranch);
  if (checkoutResult === null) {
    console.error('❌ Falha ao fazer checkout da branch de backup.');
    console.error('   Verifique se há mudanças não commitadas no branch atual.');
    return false;
  }
  console.log('   ✓ Checkout para branch de backup realizado');

  // Se o branch original for diferente do backup, tentar merge de volta
  if (originalBranch !== backupBranch && currentBranch !== backupBranch) {
    console.log('');
    console.log('   → Mesclando branch de backup de volta para ' + originalBranch + '...');
    var mergeResult = git('checkout ' + originalBranch);
    if (mergeResult === null) {
      console.log('   ⚠️  Falha ao voltar para ' + originalBranch + '. Permanecendo em ' + backupBranch);
    } else {
      console.log('   ✓ Voltei para ' + originalBranch);
      var mergeBackup = git('merge ' + backupBranch + ' --no-ff -m "rollback: restoring ' + entry.label + '"');
      if (mergeBackup === null) {
        console.log('   ⚠️  Conflitos de merge. Resolva manualmente.');
        console.log('   Branch de backup ainda disponível: ' + backupBranch);
      } else {
        console.log('   ✓ Merge concluído em ' + originalBranch);
      }
    }
  }

  // Restaurar arquivos de estado do snapshot
  console.log('');
  console.log('   → Restaurando arquivos de estado...');
  var filesToRestore = ['state.json', 'events.log', 'metrics.json', 'todolist.json'];
  var restoredCount = 0;
  filesToRestore.forEach(function (file) {
    var src = path.join(entry.dir, file);
    var dst = path.join(PIPELINE_DIR, file);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log('   ✓ ' + file + ' restaurado');
        restoredCount++;
      }
    } catch (e) {
      console.log('   ⚠️  Erro ao restaurar ' + file + ': ' + e.message);
    }
  });

  if (restoredCount > 0) {
    console.log('   ✓ ' + restoredCount + ' arquivo(s) de estado restaurado(s)');
  }

  // Marcar snapshot como usado
  entry.status = 'rolled_back';
  entry.restored_at = new Date().toISOString();
  writeIndex(index);

  console.log('');
  console.log('✅ Rollback concluído: ' + entry.label);
  console.log('');

  return true;
}

/**
 * Lista todos os snapshots disponíveis.
 * @returns {Array<{id: string, label: string, timestamp: string, branch: string, commit: string, status: string}>}
 */
function listSnapshots() {
  var index = readIndex();
  return index.map(function (entry) {
    return {
      id: entry.id,
      label: entry.label,
      timestamp: entry.timestamp,
      branch: entry.branch,
      commit: entry.commit,
      backupBranch: entry.backupBranch,
      status: entry.status
    };
  });
}

/**
 * Limpa snapshots antigos.
 * Remove snapshots com idade maior que maxAge (em dias).
 * Opcionalmente também remove as branches de backup do git.
 *
 * @param {number} [maxAge=30] - Idade máxima em dias (padrão: 30)
 * @returns {number} Número de snapshots removidos
 */
function cleanup(maxAge) {
  if (typeof maxAge === 'undefined' || maxAge === null) {
    maxAge = 30;
  }

  console.log('');
  console.log('🧹 Limpando snapshots com mais de ' + maxAge + ' dias...');
  console.log('   Max snapshots: ' + MAX_SNAPSHOTS);
  console.log('');

  var index = readIndex();
  var now = new Date().getTime();
  var maxAgeMs = maxAge * 24 * 60 * 60 * 1000;
  var removed = 0;
  var kept = [];

  // ── Fase 1: Remover por idade ─────────────────────────────────────
  index.forEach(function (entry) {
    var entryTime = new Date(entry.timestamp).getTime();
    var age = now - entryTime;

    if (age > maxAgeMs) {
      removeSnapshotDir(entry);
      removeBackupBranch(entry);
      removed++;
    } else {
      kept.push(entry);
    }
  });

  // ── Fase 2: Enforce MAX_SNAPSHOTS — manter apenas os N mais recentes ─
  if (kept.length > MAX_SNAPSHOTS) {
    kept.sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    var excess = kept.splice(MAX_SNAPSHOTS);
    excess.forEach(function (entry) {
      removeSnapshotDir(entry);
      removeBackupBranch(entry);
      removed++;
    });
    console.log('   📐 Limite MAX_SNAPSHOTS=' + MAX_SNAPSHOTS + ' aplicado — ' + excess.length + ' excesso(s) removido(s).');
  }

  // ── Fase 3: Limpar itens órfãos não indexados ─────────────────────
  var indexIds = {};
  kept.forEach(function (e) { indexIds[e.id] = true; });
  var orphanRemoved = 0;
  try {
    var dirEntries = fs.readdirSync(SNAPSHOTS_DIR);
    dirEntries.forEach(function (entry) {
      if (entry === 'index.json') return;
      var entryPath = path.join(SNAPSHOTS_DIR, entry);

      if (entry.startsWith('hlrn-')) {
        // hlrn snapshot NÃO indexado — órfão
        if (!indexIds[entry]) {
          try {
            if (fs.existsSync(entryPath)) {
              removeDirectorySync(entryPath);
              console.log('   🗑️  Órfão hlrn removido: ' + entry);
              orphanRemoved++;
            }
          } catch (e) {
            console.log('   ⚠️  Erro ao remover órfão ' + entry + ': ' + e.message);
          }
        }
      } else if (entry.startsWith('snapshot-')) {
        // Legacy snapshot-state.js — remover todos (não gerenciados por rollback-manager)
        try {
          if (fs.existsSync(entryPath)) {
            var stat = fs.statSync(entryPath);
            if (stat.isDirectory()) {
              removeDirectorySync(entryPath);
            } else {
              fs.unlinkSync(entryPath);
            }
            console.log('   🗑️  Legacy snapshot removido: ' + entry);
            orphanRemoved++;
          }
        } catch (e) {
          console.log('   ⚠️  Erro ao remover legacy ' + entry + ': ' + e.message);
        }
      } else if (entry.startsWith('checkpoint-')) {
        // Self-healing checkpoints antigos — remover todos
        try {
          if (fs.existsSync(entryPath)) {
            fs.unlinkSync(entryPath);
            console.log('   🗑️  Checkpoint órfão removido: ' + entry);
            orphanRemoved++;
          }
        } catch (e) {
          console.log('   ⚠️  Erro ao remover checkpoint ' + entry + ': ' + e.message);
        }
      }
    });
  } catch (e) {
    console.log('   ⚠️  Erro ao escanear diretório de snapshots: ' + e.message);
  }

  // Atualizar índice
  writeIndex(kept);

  console.log('');
  var totalRemoved = removed + orphanRemoved;
  if (totalRemoved > 0) {
    console.log('✅ ' + totalRemoved + ' item(ns) removido(s) (' + removed + ' gerenciados + ' + orphanRemoved + ' órfãos).');
    console.log('   Restam ' + kept.length + ' snapshot(s) ativo(s) no índice.');
  } else {
    console.log('   Nenhum snapshot antigo para limpar.');
    console.log('   Total: ' + kept.length + ' snapshot(s) ativo(s).');
  }
  console.log('');

  return { removed: totalRemoved, managed: removed, orphans: orphanRemoved, kept: kept.length };
}

/**
 * Remove o diretório de um snapshot da entrada do índice.
 * NON-BLOCKING: falhas não interrompem o cleanup.
 * @param {Object} entry
 */
function removeSnapshotDir(entry) {
  try {
    if (fs.existsSync(entry.dir)) {
      removeDirectorySync(entry.dir);
      console.log('   📁 Diretório removido: ' + entry.id);
    }
  } catch (e) {
    console.log('   ⚠️  Erro ao remover diretório ' + entry.id + ': ' + e.message);
  }
}

/**
 * Remove a branch de backup git de um snapshot.
 * NON-BLOCKING: falhas não interrompem o cleanup.
 * @param {Object} entry
 */
function removeBackupBranch(entry) {
  try {
    if (entry.backupBranch && isGitRepo()) {
      var branchExists = git('branch --list ' + entry.backupBranch);
      if (branchExists) {
        git('branch -D ' + entry.backupBranch);
        console.log('   🌿 Branch removida: ' + entry.backupBranch);
      }
    }
  } catch (e) {
    console.log('   ⚠️  Erro ao remover branch ' + entry.backupBranch + ': ' + e.message);
  }
}

/**
 * Remove um diretório recursivamente (alternativa ao fs.rmSync para Node <14).
 * @param {string} dirPath
 */
function removeDirectorySync(dirPath) {
  try {
    if (fs.rmSync) {
      // Node >= 14
      fs.rmSync(dirPath, { recursive: true, force: true });
    } else {
      // Fallback para Node mais antigo
      var entries = fs.readdirSync(dirPath);
      entries.forEach(function (entry) {
        var fullPath = path.join(dirPath, entry);
        if (fs.statSync(fullPath).isDirectory()) {
          removeDirectorySync(fullPath);
        } else {
          fs.unlinkSync(fullPath);
        }
      });
      fs.rmdirSync(dirPath);
    }
  } catch (e) {
    console.error('   ⚠️  Erro ao remover diretório ' + dirPath + ': ' + e.message);
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function showHelp() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Matrix Rollback Manager v1.0                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Sistema de rollback automático para o pipeline Matrix.');
  console.log('');
  console.log('Uso:');
  console.log('  node rollback-manager.js create <label>     Criar snapshot');
  console.log('  node rollback-manager.js list               Listar snapshots');
  console.log('  node rollback-manager.js rollback <id>      Restaurar snapshot');
  console.log('  node rollback-manager.js cleanup [maxAge]   Limpar snapshots antigos (dias)');
  console.log('  node rollback-manager.js --help             Esta mensagem');
  console.log('');
  console.log('Comandos:');
  console.log('  create <label>    Cria snapshot + branch de backup');
  console.log('                    Ex: node rollback-manager.js create "antes-da-fase-2"');
  console.log('');
  console.log('  list              Lista todos os snapshots disponíveis');
  console.log('');
  console.log('  rollback <id>     Restaura o estado de um snapshot');
  console.log('                    Ex: node rollback-manager.js rollback hlrn-2026-07-26T19-30-00-000Z');
  console.log('');
  console.log('  cleanup [maxAge]  Remove snapshots mais antigos que maxAge dias');
  console.log('                    Padrão: 30 dias');
  console.log('                    Ex: node rollback-manager.js cleanup 7');
  console.log('');
  console.log('Funcionalidades:');
  console.log('  • Cria branch matrix-rollback-<timestamp> antes de cada alteração');
  console.log('  • Registra snapshots em pipeline/snapshots/index.json');
  console.log('  • rollback faz git checkout + merge de volta');
  console.log('  • Mantém histórico de até ' + MAX_LOG_ENTRIES + ' entradas');
  console.log('  • Zero dependências npm');
  console.log('');
}

if (require.main === module) {
  var args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  var command = args[0];

  switch (command) {
    case 'create':
      var label = args.slice(1).join(' ');
      if (!label) {
        console.error('❌ Erro: informe um label para o snapshot.');
        console.error('   Uso: node rollback-manager.js create "descricao"');
        process.exit(1);
      }
      var result = createSnapshot(label);
      if (result) {
        process.exit(0);
      } else {
        process.exit(1);
      }
      break;

    case 'list':
      var snapshots = listSnapshots();
      console.log('');
      console.log('📸 Snapshots disponíveis (' + snapshots.length + '):');
      console.log('');
      if (snapshots.length === 0) {
        console.log('   (nenhum snapshot encontrado)');
      } else {
        snapshots.forEach(function (s) {
          var statusIcon = s.status === 'active' ? '🟢' : (s.status === 'rolled_back' ? '🔵' : '⚪');
          console.log('   ' + statusIcon + ' ' + s.id);
          console.log('      📝 ' + s.label);
          console.log('      🌿 ' + s.branch + ' @ ' + (s.commit ? s.commit.substring(0, 8) : 'N/A'));
          console.log('      🕐 ' + s.timestamp);
          console.log('      📊 status: ' + s.status);
          console.log('');
        });
      }
      process.exit(0);
      break;

    case 'rollback':
      var snapshotId = args[1];
      if (!snapshotId) {
        console.error('❌ Erro: informe o ID do snapshot.');
        console.error('   Uso: node rollback-manager.js rollback <snapshot-id>');
        process.exit(1);
      }
      var ok = rollback(snapshotId);
      process.exit(ok ? 0 : 1);
      break;

    case 'cleanup':
      var maxAge = parseInt(args[1], 10);
      if (isNaN(maxAge) || maxAge < 1) {
        maxAge = 30;
      }
      cleanup(maxAge);
      process.exit(0);
      break;

    default:
      console.error('❌ Comando desconhecido: ' + command);
      console.error('   Use --help para ver os comandos disponíveis.');
      process.exit(1);
  }
}

module.exports = {
  createSnapshot: createSnapshot,
  rollback: rollback,
  listSnapshots: listSnapshots,
  cleanup: cleanup
};
