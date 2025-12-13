# TICKET-01: Enforce Policy Checks for All Write & Exec Tools

## Goal
Ensure that all destructive or state-changing actions are blocked unless they pass policy validation.

## Scope
- write_file
- apply_patch
- run_tests
- run_build
- run_lint

## Requirements
- Before executing any of the above tools, call `checkActionAgainstPolicy(...)`
- Policy must validate:
  - file paths
  - number of files modified
  - total changed lines
  - blocked paths (.env, node_modules, dist, etc.)
- If policy fails:
  - tool execution must NOT happen
  - agent must receive a structured error result

## Acceptance Criteria
- No write/exec tool can run without passing policy
- Policy violations are visible in toolUsage and returned to the model
- Existing functionality remains intact
