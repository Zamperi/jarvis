# TICKET-02: Implement Plan → Approve → Execute Protocol

## Goal
Prevent uncontrolled code changes by enforcing a two-phase workflow.

## Scope
- Agent execution flow
- CLI commands: /task-plan, /task-approve, /task-exec

## Requirements
- PLAN phase:
  - Agent may only read files
  - Output must include:
    - list of files to be modified
    - reason for each change
    - estimated impact
- EXECUTE phase:
  - Only allowed after explicit approval
  - Agent may only modify files declared in the plan
- Reject execution if:
  - No plan exists
  - Plan hash does not match approval

## Acceptance Criteria
- Agent cannot write or patch without an approved plan
- Plan and execution are linked by runId
- Violations result in hard failure
