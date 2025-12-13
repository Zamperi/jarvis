export type ModelId =
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "claude-opus-4.1";

export interface ModelProfile {
  id: ModelId;
  provider: "azure-openai" | "anthropic";
  deployment: string;
  inputCostPer1M: number;   // USD
  outputCostPer1M: number;  // USD
  maxContextTokens: number;
}

/**
 * Päivitä deployment-nimet vastaamaan Azure AI Foundrya
 */
export const MODEL_PROFILES: Record<ModelId, ModelProfile> = {
  "gpt-4.1": {
    id: "gpt-4.1",
    provider: "azure-openai",
    deployment: "gpt-4.1",
    inputCostPer1M: 10,
    outputCostPer1M: 30,
    maxContextTokens: 128_000,
  },

  "gpt-4.1-mini": {
    id: "gpt-4.1-mini",
    provider: "azure-openai",
    deployment: "gpt-4.1-mini",
    inputCostPer1M: 0.5,
    outputCostPer1M: 1.5,
    maxContextTokens: 128_000,
  },

  "claude-opus-4.1": {
    id: "claude-opus-4.1",
    provider: "anthropic",
    deployment: "claude-opus-4-1",
    inputCostPer1M: 25,
    outputCostPer1M: 100,
    maxContextTokens: 200_000,
  },
};
