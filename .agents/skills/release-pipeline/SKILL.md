---
name: release-pipeline
description: >
  Gerencia o pipeline de release automatizado do Matrix: version bump,
  changelog, tag, build, deploy. GLOBAL — funciona para qualquer projeto
  que tenha release-config.yaml na raiz.
mode: skill
color: '#38b2ac'
---

# 🚀 Matrix Release Pipeline

Skill global para automatizar releases de qualquer projeto Matrix.

## 📋 Pré-requisitos

- Projeto com `release-config.yaml` na raiz
- Git configurado com remote
- GitHub CLI (`gh`) autenticado (opcional para deploy)

## 🔄 Fluxo de Release

1. **Version Bump** — Lê versão atual de `version_file`, incrementa
   (patch/minor/major conforme `release-config.yaml`), escreve de volta
2. **Changelog** — Adiciona entrada no `CHANGELOG.md` com data e descrição
3. **Tag** — Cria tag git `vX.Y.Z` no commit atual
4. **Build** — Executa `pre_release_hooks` (ex: testes, lint)
5. **Deploy** — Publica GitHub Release via `gh release create`

## 📁 Arquivos

| Arquivo | Função |
|---------|--------|
| `pipeline/release-pipeline.yaml` | State machine do release |
| `pipeline/release-config.yaml` | Template de configuração |
| `release-config.yaml` (projeto) | Config específica do projeto |

## 🔧 Como Usar

1. Copie `pipeline/release-config.yaml` para a raiz do projeto e personalize
2. Quando quiser fazer release: `@AgentsOrchestrator, iniciar release`
3. O orchestrator carrega a skill `release-pipeline` e executa o fluxo

## ⚙️ Detalhamento dos Estados

### init
- **idle**: Aguardando solicitação de release

### prep
- **version_bump**: Lê `version_file`, incrementa conforme `auto_increment` e escreve de volta
- **changelog**: Adiciona entrada datada em `changelog_file`
- **tag**: Cria tag git com prefixo + versão (ex: `v1.2.3`)

### build
- **build**: Executa hooks de pre-release na ordem definida
- **deploy**: Publica GitHub Release + hooks post-release

### final
- **completed**: ✅ Release concluída
- **failed**: ❌ Falha — retentativa via reset manual
- **escalated**: ⚠️ Máx 3 tentativas excedido

## 🧪 Exemplo de Uso

```bash
# 1. Copiar template para o projeto (se ainda não existe)
cp pipeline/release-config.yaml ../meu-projeto/release-config.yaml

# 2. Editar configurações
#    - version_file: caminho para arquivo de versão
#    - auto_increment: "patch", "minor" ou "major"
#    - pre_release_hooks: comandos a executar antes do build

# 3. Solicitar release ao orchestrator
#    @AgentsOrchestrator, iniciar release para meu-projeto
```

## 🔄 Integração com State Machine

Este skill é acionado pelo `@agents-orchestrator` que:
1. Lê `release-pipeline.yaml` para saber os estados e transições
2. Lê `release-config.yaml` do projeto para obter paths e hooks
3. Avança estado por estado, executando as ações descritas
4. Em caso de falha, respeita `max_retries` antes de escalar
