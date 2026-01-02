// src/tools/policyTools.ts
import path from "path";

export interface PolicyConfig {
  projectRoot: string;
  allowedPaths: string[];
  readOnlyPaths: string[];
  maxFilesChanged: number;
  maxTotalChangedLines: number;
}

export type ActionKind =
  | "writeFile"
  | "applyPatch"
  | "runTests"
  | "runBuild"
  | "runLint";

export interface ActionDescription {
  kind: ActionKind;
  targetPaths?: string[];
  description?: string;
  changedLines?: number;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  violations?: string[];
}

export function checkActionAgainstPolicy(
  action: ActionDescription,
  policy: PolicyConfig
): PolicyResult {
  const violations: string[] = [];
  const { projectRoot, allowedPaths, readOnlyPaths } = policy;

  const targets = action.targetPaths ?? [];

  const allowedRoots = allowedPaths.map((p) => path.resolve(projectRoot, p));
  const readOnlyRoots = readOnlyPaths.map((p) => path.resolve(projectRoot, p));

  for (const target of targets) {
    const abs = path.resolve(target);

    const allowed = allowedRoots.some((root) => abs.startsWith(root));
    if (!allowed) {
      violations.push(`Target outside allowed paths: ${abs}`);
      continue;
    }

    const ro = readOnlyRoots.some((root) => abs.startsWith(root));
    if (ro) {
      violations.push(`Target is read-only: ${abs}`);
    }
  }

  if (
    typeof action.changedLines === "number" &&
    action.changedLines > policy.maxTotalChangedLines
  ) {
    violations.push(
      `Too many changed lines: ${action.changedLines} > ${policy.maxTotalChangedLines}`
    );
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: "Policy violations",
      violations,
    };
  }

  return { allowed: true };
}
