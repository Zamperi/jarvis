// src/agent/agentConfig.ts
import { roleAccessConfig, AgentRole } from "../config/projectConfig";
import { agentRoleConfig } from "../config/agentRoleConfig";
import { UsageSnapshot, RunAgentCost } from "./agentTypes";

// Hintahaarukka gpt-4.1-mini: input 0.15$/1M, output 0.60$/1M
// -> per 1k tokenia:
const INPUT_COST_PER_1K_USD = 0.00015;
const OUTPUT_COST_PER_1K_USD = 0.0006;
// karkea muunnos euroiksi – tarvittaessa säädettävissä
const USD_TO_EUR = 0.93;

export const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.git/**",
  "**/migrations/**",
  "**/prisma/migrations/**",
];

export const MAX_TOOL_ROUNDS = 10;

const BLOCKED_SUBSTRINGS = [
  "/node_modules/",
  "/dist/",
  "/build/",
  "/.next/",
  "/coverage/",
  "/.git/",
  "/migrations/",
];

export function isBlockedPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  return BLOCKED_SUBSTRINGS.some((s) => norm.includes(s));
}

export interface PolicyConfig {
  projectRoot: string;
  allowedPaths: string[];
  readOnlyPaths: string[];
  maxFilesChanged: number;
  maxTotalChangedLines: number;
  allowedTools: string[];
}

export function buildPolicy(
  role: AgentRole,
  projectRoot: string
): PolicyConfig {
  const rules = roleAccessConfig[role];
  const roleCfg = agentRoleConfig[role];

  return {
    projectRoot,
    allowedPaths: rules.allowedPaths,
    readOnlyPaths: [
      ...rules.readOnlyPaths,
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.git/**",
      "**/migrations/**",
    ],
    maxFilesChanged: roleCfg.maxFilesChanged,
    maxTotalChangedLines: roleCfg.maxTotalChangedLines,
    allowedTools: roleCfg.allowedTools,
  };
}

export function calculateCostFromUsage(
  usage: UsageSnapshot
): RunAgentCost {
  const inputUSD =
    (usage.promptTokens / 1000) * INPUT_COST_PER_1K_USD;
  const outputUSD =
    (usage.completionTokens / 1000) * OUTPUT_COST_PER_1K_USD;
  const totalUSD = inputUSD + outputUSD;
  const totalEUR = totalUSD * USD_TO_EUR;

  return {
    usd: totalUSD,
    eur: totalEUR,
  };
}
