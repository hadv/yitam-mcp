#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { DatabaseService } from '../../services/database/database-service';
import { FormattedResult } from '../../types/qdrant';
import { YitamTool, RetrievalConfig, RetrievalArgs } from '../../types/declarations/retrieval';
import { StreamableHttpTransport } from '../transport/http-transport';

// Load environment variables
dotenv.config();

class YitamTools {
  private readonly config: RetrievalConfig;

  constructor(
    private readonly dbService: DatabaseService,
    config?: Partial<RetrievalConfig>
  ) {
    this.config = {
      defaultLimit: 10,
      minScoreThreshold: 0.7,
      maxResults: 20,
      ...config
    };
  }

  private validateSearchParams(limit: number, scoreThreshold: number): void {
    if (limit <= 0 || limit > this.config.maxResults) {
      throw new Error(`Limit must be between 1 and ${this.config.maxResults}`);
    }
    if (scoreThreshold < 0 || scoreThreshold > 1) {
      throw new Error('Score threshold must be between 0 and 1');
    }
  }

  private async performSearch(query: string, limit: number, scoreThreshold: number, domains?: string[]): Promise<FormattedResult[]> {
    return await this.dbService.search(query, limit, scoreThreshold, domains);
  }

  getTools(): YitamTool[] {
    return [
      {
        name: 'query_domain_knowledge',
        description: `Search and retrieve domain-specific knowledge using semantic similarity.

The tool analyzes your input query and returns relevant information from the knowledge base.

You can optionally specify which domains to search in, such as:
- nội kinh
- đông y
- y học cổ truyền
- y tông tâm lĩnh
- hải thượng lãn ông
- lê hữu trác
- y quán
- y quán đường
- âm dương ngũ hành
- dịch lý
- lão kinh
- lão tử
- phong thủy
- đạo phật
and more...

Pro tip: For comprehensive insights, you can search across multiple complementary domains in one query.
For example:
- Combine "đông y" with "y học cổ truyền" for complete Vietnamese medical perspectives
- Search "phong thủy" with "âm dương ngũ hành" for holistic feng shui analysis
- Query "đạo phật" with "dịch lý" for deeper philosophical understanding

If no domains are specified, it searches across all available domains.
Results are ranked by relevance score, showing the most pertinent information from each selected domain.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query for retrieving domain knowledge" },
            domains: { 
              type: "array", 
              items: { type: "string" },
              description: "List of specific domains to search within (optional)",
            },
            limit: { 
              type: "number", 
              default: this.config.defaultLimit, 
              description: `Number of results to retrieve (max ${this.config.maxResults})` 
            },
            scoreThreshold: { 
              type: "number", 
              default: this.config.minScoreThreshold, 
              description: "Minimum similarity score threshold (0-1)" 
            },
          },
          required: ["query"],
        },
        handler: async ({ query, domains, limit = this.config.defaultLimit, scoreThreshold = this.config.minScoreThreshold }: RetrievalArgs) => {
          try {
            this.validateSearchParams(limit, scoreThreshold);
            const results = await this.performSearch(query, limit, scoreThreshold, domains);
            return { 
              success: true,
              results
            };
          } catch (error) {
            console.error('Error in query_domain_knowledge:', error);
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
          }
        }
      }
    ];
  }
}

async function listToolsHandler() {
  const tools = yitamTools.getTools();
  return { tools };
}

async function callToolHandler(request: any) {
  const { name, args } = request.params;
  
  const tool = yitamTools.getTools().find(t => t.name === name);
  if (!tool) {
    throw { 
      code: ErrorCode.InvalidParams, 
      message: `Tool not found: ${name}`
    };
  }
  
  const result = await tool.handler(args);
  return result;
}

async function runServer() {
  try {
    // Initialize database service
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Create YitamTools instance
    global.yitamTools = new YitamTools(dbService);
    
    // Get configuration from environment variables
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '127.0.0.1';
    
    // Create an MCP server
    const server = new Server({
      name: 'yitam-mcp',
      version: '1.0.0',
      capabilities: {
        incremental: true,
        streamable: true,
      }
    });
    
    // Register request handlers
    server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
    server.setRequestHandler(CallToolRequestSchema, callToolHandler);
    
    // Create HTTP transport
    const httpTransport = new StreamableHttpTransport({
      port,
      host,
      sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
    });
    
    // Connect the transport to the server
    await httpTransport.connect(server);
    
    console.log(`MCP Server running at http://${host}:${port}`);
    
    // Handle termination signals
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      await httpTransport.close();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down server...');
      await httpTransport.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run the server
runServer();

// Global type definition for yitamTools
declare global {
  var yitamTools: YitamTools;
} 