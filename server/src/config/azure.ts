import { AzureOpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-04-01-preview";

if (!endpoint || !apiKey || !deployment) {
  throw new Error("Azure OpenAI -ympäristömuuttujat puuttuvat (.env).");
}

export const azureConfig = {
  endpoint,
  apiKey,
  deployment,
  apiVersion,
};

export const openaiClient = new AzureOpenAI({
  endpoint,
  apiKey,
  apiVersion,
});
