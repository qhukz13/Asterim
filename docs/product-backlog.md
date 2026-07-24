# Asterim Commercial Product Backlog

## Overview

This backlog organizes all planned feature deliverables into strict execution phases leading to the commercial public beta. Each task includes explicit user value justification to prevent speculative or low-impact architectural work.

---

## Phase 1 — Product UX (Linear / Cursor Tier Interface)

| ID | Feature | User Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| **UX-101** | Redesign Main Workspace Shell & Navigation | Establishes modern, professional layout with collapsible sidebar and clear workspace context. | High | Pending |
| **UX-102** | Design Tokens & Modern Dark Theme System | Eliminates visual noise, standardizes typography, colors, and interactive surface states. | High | Pending |
| **UX-103** | Command Palette (`Cmd+K`) Navigation Engine | Allows keyboard-first power users to rapidly switch projects, threads, and trigger actions. | High | Pending |
| **UX-104** | Streamlined Agent Chat & Live Terminal Inspector | Gives users clear visibility into streaming stdout, tool invocations, and diffs without lag. | High | Pending |
| **UX-105** | Projects & Missions Dashboard | Provides engineering managers a high-level view of active projects, agent tasks, and outcomes. | Medium | Pending |

---

## Phase 2 — Authentication & Access Control

| ID | Feature | User Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| **AUTH-201** | User Model & Database Migration Schema | Foundation for individual user accounts, security credentials, and profile settings. | High | Pending |
| **AUTH-202** | Registration, Login & Password Recovery APIs | Enables user onboarding and secure authentication workflows for self-hosted and cloud. | High | Pending |
| **AUTH-203** | JWT Session & Cookie Management | Provides seamless authentication with automatic token rotation without breaking active sessions. | High | Pending |
| **AUTH-204** | Protected Route Guards & Fastify Auth Middleware | Guarantees unauthenticated users cannot access workspace data or invoke server operations. | High | Pending |
| **AUTH-205** | Machine-to-Machine API Tokens | Enables secure headless CLI execution, remote workstation pairing, and automation scripts. | Medium | Pending |

---

## Phase 3 — Teams & Collaborative Workspaces

| ID | Feature | User Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| **TEAM-301** | Organization & Workspace Data Hierarchy | Allows teams to group projects, invite colleagues, and centralize management. | High | Pending |
| **TEAM-302** | Team Roster, Member Invitations & Join Flow | Enables seamless colleague onboarding via email invitations and shareable link tokens. | High | Pending |
| **TEAM-303** | Shared Agent Threads & Real-Time Observation | Allows team members to observe agent executions in real time and collaborate on solutions. | High | Pending |
| **TEAM-304** | RBAC Permission Gates & Role Management | Controls who can dispatch agents, execute commands, approve file mutations, or edit settings. | High | Pending |
| **TEAM-305** | Workspace Audit Log & Activity Stream | Gives security-conscious tech leads full compliance visibility over all human and agent actions. | Medium | Pending |

---

## Phase 4 — Developer Workstation (Local Engine Hardening)

| ID | Feature | User Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| **DEV-401** | Subprocess Lifecycle & Auto-Recovery | Prevents crashed agent processes from locking the UI or corrupting active session state. | High | Pending |
| **DEV-402** | Xterm.js Backpressure & Buffer Throttling | Prevents browser UI lockup when agents produce burst output (10,000+ log lines). | High | Pending |
| **DEV-403** | Hardened Shell & AST Approval Interceptors | Guarantees dangerous shell commands or destructive file mutations are paused for human review. | High | Pending |
| **DEV-404** | Native Git Inspector & Auto-Commit Assistant | Streamlines version control with instant diff previews, branch management, and AI commit generation. | High | Pending |
| **DEV-405** | Fast Workspace Symbol Indexing & Context Engine | Ensures agents receive relevant, token-efficient codebase context for higher task accuracy. | Medium | Pending |

---

## Phase 5 — SaaS Foundation & Public Beta Release

| ID | Feature | User Value | Priority | Status |
| :--- | :--- | :--- | :--- | :--- |
| **SAAS-501** | Production Postgres & Cloud Multi-Tenancy | Scalable database architecture powering web access, team workspaces, and remote connections. | High | Pending |
| **SAAS-502** | Secure Cloud WebSocket Relay Gateway | Enables mobile/web access to local workstation agents from anywhere without firewall configuration. | High | Pending |
| **SAAS-503** | Stripe Subscription Billing & Plan Entitlements | Commercial payment processing for Free, Pro, and Team billing plans. | High | Pending |
| **SAAS-504** | Bi-directional Cloud & Local Metadata Sync | Keeps project context bookmarks, user preferences, and thread summaries synced across devices. | Medium | Pending |
| **SAAS-505** | Automated CI/CD, Telemetry & Release Pipeline | Ensures high uptime, error tracking, and smooth deployment of public releases. | High | Pending |
