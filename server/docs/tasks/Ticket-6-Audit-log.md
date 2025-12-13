# TICKET-06: Full Audit Log per runId

## Goal
Make all agent actions traceable and reviewable.

## Scope
- Tool calls
- File changes
- Model usage

## Requirements
Log the following per runId:
- timestamped tool calls (name, args hash, duration)
- tool results (ok, summary)
- file diffs / patches
- token usage and cost
- final outcome (success/failure)

## Acceptance Criteria
- Complete reconstruction of any run is possible
- Logs are structured (JSON or DB-ready)
