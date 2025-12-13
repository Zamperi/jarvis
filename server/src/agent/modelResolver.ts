import { AgentRole } from "../config/projectConfig";
import { RunMode } from "./agentTypes";
import { ModelId } from "../config/modelProfiles";

/**
 * Keskitetty paikka jossa päätetään:
 * mitä mallia käytetään mihinkin
 */
export function resolveModel(
  args: {
    role: AgentRole;
    mode: RunMode;
  }
): ModelId {
  const { role, mode } = args;

  // PLAN = kallis mutta fiksu
  if (mode === "plan") {
    return "claude-opus-4.1";
  }

  // Dokumentointi ei vaadi raskasta mallia
  if (role === "documenter") {
    return "gpt-4.1-mini";
  }

  // Kaikki toteutus
  return "gpt-4.1-mini";
}
