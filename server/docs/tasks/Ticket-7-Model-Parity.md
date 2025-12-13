# TICKET-07: Model Parity and Fallback (OpenAI ↔ Anthropic)

## Goal
Ensure identical behavior regardless of model provider.

## Scope
- Tool schema
- Tool-loop behavior
- Error handling

## Requirements
- Unified tool schema for both providers
- Identical tool-loop semantics
- Automatic fallback if:
  - no tool_use is emitted
  - model hallucinates tool usage
  - provider returns unsupported response

## Acceptance Criteria
- Switching model does not change agent behavior
- Failures are handled gracefully and transparently
