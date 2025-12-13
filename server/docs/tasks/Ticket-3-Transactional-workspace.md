# TICKET-03: Add Transactional Workspace with Rollback

## Goal
Allow safe experimentation by isolating agent changes.

## Scope
- File system handling
- Agent run lifecycle

## Requirements
- Each runId operates in its own workspace:
  - git branch OR temp working directory
- On failure (tests/lint/build):
  - changes must be rolled back or isolated
- On success:
  - changes can be merged/applied explicitly

## Acceptance Criteria
- Agent never corrupts the main working directory
- Failed runs leave no persistent side effects
- Rollback is automatic and deterministic
