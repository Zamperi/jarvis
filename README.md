# Agent Platform – README

## Overview

This project implements a modular, extensible agent platform built on Node.js + TypeScript. The platform exposes both an HTTP API and a CLI interface for running autonomous or tool-assisted agents. Each agent operates with a clear role definition, controlled tool permissions, and an execution pipeline that supports planning, coding, testing, documentation, and custom tool use.

The architecture is intentionally simple but production-oriented: strict typing, isolated modules, clean separation of agent logic, HTTP routing, configuration, tool registry, and execution orchestration.

## Features

### • Multi-Agent Architecture
Agents are defined through role configurations that specify:
- role name
- capabilities
- execution instructions
- allowed tools

Agents can be extended or restricted without modifying core logic.

### • Tool-Driven Workflow
Tools are registered in a central registry and injected into agents at runtime.
Examples:
- file reading and writing
- patch application
- command execution
- TypeScript checks

Agent runs can be strictly controlled through these tool permissions.

### • HTTP API
The Express server exposes endpoints for triggering agent runs programmatically.
`agentRoutes.ts` maps REST endpoints to service functions.

### • CLI Interface
`agentCli.ts` enables launching agents directly from the terminal with arguments.

### • Strong Type Safety
`agentTypes.ts` defines all core types:
- AgentRole
- AgentTask
- Tool definitions
- Execution context
- Agent responses

### • Execution Runtime
`agentRunner.ts` orchestrates:
- task creation
- agent role selection
- history/context handling
- step-based execution
- calling tools when required

### • Service Layer
`agentService.ts` connects HTTP routes, runner logic, and configuration into a cohesive API.

## File Structure

project/
│
├── server.ts              
├── agentRoutes.ts         
│
├── agentConfig.ts         
├── agentTypes.ts          
├── agentService.ts        
├── agentRunner.ts         
│
├── toolsRegistry.ts       
├── agentCli.ts            
│
└── README.md

## Installation

npm install

## Running the Server

npm run dev

Health check:
GET /health

## Running the Agent via CLI

node dist/agentCli.js --role coder --task "Refactor the codebase"

## Extending the System

### Adding a New Agent Role
Modify `agentConfig.ts` and define:
- name
- system instructions
- allowed tools

### Adding a New Tool
Implement a module and register it in `toolsRegistry.ts`.

## License

Proprietary. All rights reserved.
