import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface RetrievalConfig {
  defaultLimit: number;
  minScoreThreshold: number;
  maxResults: number;
}

export interface RetrievalArgs {
  query: string;
  limit?: number;
  scoreThreshold?: number;
}

export interface YitamTool extends Tool {
  handler: (args: RetrievalArgs) => Promise<unknown>;
} 