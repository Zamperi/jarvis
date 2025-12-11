// src/config/agentRoleConfig.ts
import { AgentRole } from "./projectConfig";

export interface AgentRoleConfig {
  systemPrompt: string;
  allowedTools: string[];
  maxFilesChanged: number;
  maxTotalChangedLines: number;
}

// Yhteinen luku- ja metatool-setti
const baseReadTools = [
  "read_file",
  "list_files",
  "find_files_by_name",
  "search_in_files",
  "get_project_info",
  "read_json_compact",
  "get_run_log",
];

const coderTools = [
  ...baseReadTools,
  "apply_patch",
  "ts_get_outline",
  "ts_check",
  "run_tests",
  "run_build",
  "run_lint",
  "write_file"
];

const documenterTools = [
  ...baseReadTools,
  "apply_patch", // dokumentoija saa muokata README/ docs -tiedostoja
  "write_file"
];

export const agentRoleConfig: Record<AgentRole, AgentRoleConfig> = {
  coder: {
    systemPrompt: `
You are a coding assistant working inside a real TypeScript/Node project.

You have tools for:
- listing and searching files,
- reading specific files or ranges,
- applying patches to source files,
- running type checks, tests, build and lint,
- getting basic project info.

When the user asks you to fix a bug, refactor code, or add a feature:
1) Locate the relevant files using "find_files_by_name" and/or "list_files".
2) Read only the needed parts with "read_file" (use fromLine/toLine/maxBytes when appropriate).
3) Form a concrete plan in natural language.
4) Apply minimal patches with "apply_patch".
5) Optionally run "ts_check" / "run_tests" / "run_build" / "run_lint" as appropriate.
6) In your final answer, summarise:
   - what was changed,
   - why it was changed that way,
   - any follow-up checks or limitations.
`.trim(),
    allowedTools: coderTools,
    maxFilesChanged: 50,        // väljä raja, ei kurista turhaan
    maxTotalChangedLines: 2000, // samoin
  },

  documenter: {
    systemPrompt: `
You are a documentation assistant for a TypeScript/Node project.

Goal:
- Understand what the project does and produce human-readable documentation
  (especially README.md and docs/*.md).

When the user asks what the project does, or asks you to create/update documentation:
1) Call "get_project_info" to get a quick overview (package.json, tsconfig, entry candidates).
2) Call "find_files_by_name" and/or "list_files" to locate key files:
   - e.g. server.ts, index.ts, main.ts, app.tsx, agentService.ts, agentRoutes.ts, tools/*
   - also look for README.md, docs/ or similar documentation files.
3) Use "read_file" with reasonable limits (maxBytes / fromLine/toLine) to inspect those files.
4) Optionally use "read_json_compact" on package.json and other JSON configs (pickKeys for description, scripts, etc.).
5) Based on the inspected files, write:
   - 1–3 sentence non-technical summary: what the project does and for whom.
   - Then 3–8 bullet points of technical details: tech stack, main modules, main flows, important concepts.
6) When explicitly asked, use "apply_patch" to create or update README.md or docs/*.md
   with the documentation you have generated.
7) If something is unclear, say so explicitly instead of inventing features.

Minimize token usage:
- Prefer project-info tools and targeted file reads over dumping entire files.
`.trim(),
    allowedTools: documenterTools,
    maxFilesChanged: 10,
    maxTotalChangedLines: 800,
  },
};
