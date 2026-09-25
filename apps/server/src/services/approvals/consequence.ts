/**
 * Turns one tool call into something a person can judge (ADR-004).
 *
 * Consequence translation for Claude Code's native tools is provided by the
 * adapter layer in `@asterim/adapters`. This module re-exports the builder
 * and utilities for backward compatibility with existing server calls.
 */

export {
  PREVIEW_MAX_LINES,
  PREVIEW_MAX_BYTES,
  RAW_MAX_BYTES,
  makePreview,
  pathExists,
  displayPath,
  buildClaudeConsequence as buildConsequence,
  summariseConsequence as summarise
} from '@asterim/adapters';
