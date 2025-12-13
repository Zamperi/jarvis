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
