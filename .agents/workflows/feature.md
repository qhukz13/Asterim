# Feature Workflow

## Prerequisites

- The feature MUST exist in the Product Specification.
- You MUST understand the relevant subsystem architecture.

## Execution Steps

1. Create a feature branch.
2. Implement the frontend/backend changes concurrently if possible.
3. Write integration tests for the new capability.

## Validation

- Ensure no existing Golden Loop latency is impacted.
- Run `turbo run lint` and `turbo run build`.

## Completion Criteria

- Review passed against `CODE_REVIEW_GUIDE.md`.
