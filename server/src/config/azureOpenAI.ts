// src/config/azure.ts
import OpenAI from "openai";

const endpointEnv = process.env.AZURE_OPENAI_ENDPOINT;
const apiKeyEnv = process.env.AZURE_AI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2025-01-01-preview";

if (!endpointEnv) throw new Error("Missing AZURE_OPENAI_ENDPOINT");
if (!apiKeyEnv) throw new Error("Missing AZURE_AI_API_KEY (or AZURE_OPENAI_API_KEY)");

const baseURL = endpointEnv.replace(/\/+$/, ""); // ÄLÄ lisää /openai/deployments tänne

export const openaiClient = new OpenAI({
  apiKey: apiKeyEnv,
  baseURL,
  defaultQuery: { "api-version": apiVersion },
  defaultHeaders: { "api-key": apiKeyEnv },
});
