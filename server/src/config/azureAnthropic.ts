// src/config/azureAnthropic.ts

const endpointEnv = process.env.AZURE_ANTHROPIC_ENDPOINT;
const apiKeyEnv = process.env.AZURE_AI_API_KEY;
const anthropicVersionEnv = process.env.AZURE_ANTHROPIC_VERSION ?? "2023-06-01";

if (!endpointEnv) throw new Error("Missing env: AZURE_ANTHROPIC_ENDPOINT");
if (!apiKeyEnv) throw new Error("Missing env: AZURE_AI_API_KEY");

const ENDPOINT: string = endpointEnv.replace(/\/+$/, "");
const API_KEY: string = apiKeyEnv;
const ANTHROPIC_VERSION: string = anthropicVersionEnv;

/* ===========================
   Content blocks (minimilaajennus tools-käyttöön)
=========================== */
export type ClaudeTextBlock = { type: "text"; text: string };

export type ClaudeTool = {
  name: string;
  description?: string;
  input_schema: any; // JSON Schema
};

export type ClaudeToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: any;
};

export type ClaudeToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  // Anthropic hyväksyy "content": string tai blokit; pidetään blokit kuten runnerissa
  content: ClaudeTextBlock[] | string;
  is_error?: boolean;
};

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock;

export type ClaudeMessage = {
  role: "user" | "assistant";
  content: ClaudeContentBlock[];
};

export type ClaudeMessagesCreateRequest = {
  model: string;        // deployment name, esim "claude-opus-4-1"
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string;
  temperature?: number;

  // === MINIMI: salli tools kenttä ===
  tools?: ClaudeTool[];
};

export type ClaudeMessagesCreateResponse = {
  // === MINIMI: content voi sisältää myös tool_use (ja joissain toteutuksissa tool_result) ===
  content?: ClaudeContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export async function azureAnthropicMessagesCreate(
  payload: ClaudeMessagesCreateRequest
): Promise<ClaudeMessagesCreateResponse> {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("x-api-key", API_KEY);
  headers.set("anthropic-version", ANTHROPIC_VERSION);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Anthropic request failed: ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json as ClaudeMessagesCreateResponse;
}

export function extractClaudeText(resp: ClaudeMessagesCreateResponse): string {
  return (resp.content ?? [])
    .filter((b): b is ClaudeTextBlock => b?.type === "text")
    .map((b) => b.text)
    .join("");
}
