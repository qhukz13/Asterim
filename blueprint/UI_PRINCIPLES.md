# Asterim UI Architecture Principles

This document defines the architectural principles that every UI feature in Asterim must follow. This is the long-term UI architecture contract.

## 1. Everything has exactly one owner
State duplication is forbidden. Every piece of data must have exactly one source of truth, typically a specific domain store (e.g., `ThreadStore`, `ExecutionStore`). Components must observe state, not own it. Avoid local component state becoming the source of truth.

## 2. Navigation follows the Domain Model
The visual hierarchy is a strict projection of the Domain Model: Workspace → Project → Thread → Execution. URL routing must reflect this exact hierarchy. You do not navigate between "pages"; you navigate through the domain.

## 3. Views never own business logic
Views (Chat, Terminal, Diff, Blueprint) are merely lenses into the active Thread or Execution. They render state provided by their respective stores and emit events when the user interacts. They do not fetch data, hold long-lived state, or define domain logic.

## 4. Inspector reflects selection
The Inspector never owns business data. It only reflects the currently selected domain entity. All Inspector content should be derived from the active Workspace selection (e.g., selecting a file shows Git history; selecting an Execution shows logs).

## 5. Everything is keyboard-first
The Command Palette is global and treated as the primary interaction system. It is not an optional feature. Every action achievable via the mouse should be achievable via the Command Palette or keyboard shortcuts.

## 6. Workspace state is restorable
Asterim remembers the environment. If the user closes the application and reopens it, the exact Workspace, Project, Thread, View, and Panel configurations must be restored automatically.

## 7. New features must integrate without redesigning the Workspace
The OS-level architecture (Left Sidebar, Center Sidebar, Main Workspace, Inspector) is foundational. Future capabilities (e.g., Team Collaboration, Multi-Agent Orchestration, Cloud Relay) must be built within this existing panel system and interaction model without redesigning the Workspace.
