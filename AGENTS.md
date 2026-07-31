# AGENTS.md — Matrix Engine Architecture Reference

This file documents the agent and tool architecture used internally by the Matrix Model Amplification Engine.

## Architecture Principle

```
TASK → STRATEGY → AGENT ROUTER → SPECIALIST
```

Specialists are invoked only when the Strategy Engine determines they add value.
NEVER call all agents. NEVER call agents by intuition.

## Agent Routing

| Domain | Specialists |
|--------|------------|
| Engineering | @backend-architect, @senior-developer, @software-architect, @multi-agent-systems-architect |
| Quality | @code-reviewer, @fable-judge, @security-agent |
| Data | @database-optimizer, @data-engineer |
| DevOps | @devops-automator, @sre-site-reliability-engineer |

## Rule: Use code for what code solves better

- Use code → deterministic operations (file search, parsing, validation)
- Use tools → environment operations (shell, git, file system)
- Use specialists → domain expertise required
- Use model → only when generative reasoning is needed
