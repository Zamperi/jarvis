
# TICKET-05: Deterministic Self-Improvement Loop

## Goal
Prevent infinite or chaotic self-modification loops.

## Scope
- Agent execution strategy

## Required Loop Order
1. ts_check → fix type errors
2. run_lint → fix lint issues
3. run_tests → fix failing tests

## Constraints
- Max 2–3 iterations per phase
- Abort if no progress is made
- Abort on repeated identical failures

## Acceptance Criteria
- Agent converges or stops deterministically
- No infinite refactor/test loops