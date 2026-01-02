// src/tools/toolSchemas.ts
import { z } from "zod";

/**
 * Tool output schemas (runtime contract enforcement)
 *
 * Goal: prevent agents from "inventing" new return shapes that break callers.
 * Keep these schemas aligned with the TypeScript interfaces used by tools.
 */

export const ApplyPatchResultSchema = z.object({
  filePath: z.string(),
  changed: z.boolean(),
  newHash: z.string().optional(),
  preview: z.string().optional(),
});

export const WriteFileToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  violations: z.any().optional(),
});

export type ApplyPatchResult = z.infer<typeof ApplyPatchResultSchema>;
