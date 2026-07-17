# AgentDeck AI Development System

## What is this directory?
The `.agents` directory is a lightweight AI operating system. It defines **how AI agents work**, providing the development workflow, behavioral rules, and engineering templates required to contribute to AgentDeck.

## How it differs from `/blueprint`
- **`/blueprint`** defines **the product** (What we are building). It is the normative Source of Truth.
- **`.agents`** defines **the process** (How we build it). It is a set of operational instructions for AI agents.

## Why Blueprint is the Source of Truth
The Product Specification located in `blueprint` governs all architectural and product decisions. `.agents` must **never** duplicate the Blueprint. It strictly references it.

## For New Contributors
If you are an AI agent starting work:
1. Read `AGENT_RULES.md` to understand your operational boundaries.
2. Follow `TASK_WORKFLOW.md` for every assigned task.
