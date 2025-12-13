# TICKET-04: Standardize ToolResult Output Schema

## Goal
Make tool feedback consistent and machine-reasonable.

## Scope
- All tools (file, ts, exec, search)

## Required ToolResult Schema
```ts
{
  ok: boolean;
  summary: string;
  details?: any;
  artifacts?: { path: string }[];
}
Requirements
Every tool must return this structure

Errors must use ok: false with a meaningful summary

Agent logic must rely on this schema instead of ad-hoc parsing

Acceptance Criteria
No tool returns raw strings or inconsistent objects

Agent reasoning improves (fewer retries, clearer fixes)

yaml
Kopioi koodi

---

```md
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