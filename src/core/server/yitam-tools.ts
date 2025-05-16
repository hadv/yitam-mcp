#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

// Helper functions for server operations
async function listToolsHandler() {
  return {
    tools: global.yitamTools.getTools(),
  };
}

async function callToolHandler(request: any) {
  const { name, arguments: args } = request.params;
  
  try {
    const tool = global.yitamTools.getTools().find(t => t.name === name);
    if (!tool) {
      throw { 
        code: ErrorCode.InvalidParams, 
        message: `Tool not found: ${name}`
      };
    }

    if (!args?.query) {
      throw { 
        code: ErrorCode.InvalidParams, 
        message: 'Query parameter is required'
      };
    }

    const result = await tool.handler({
      query: String(args.query),
      domains: Array.isArray(args.domains) ? args.domains : (args.domains ? [args.domains] : undefined),
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      scoreThreshold: typeof args.scoreThreshold === 'number' ? args.scoreThreshold : undefined
    });
    
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  } catch (error) {
    console.error(`Error during tool execution (${name}):`, error);
    
    if (error instanceof Error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      throw error; // Rethrow structured errors with code and message
    } else {
      return {
        content: [{ type: "text", text: `Error: Unknown error occurred` }],
        isError: true,
      };
    }
  }
}

// Server startup
async function runServer() {
  try {
    // Initialize the database service
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Create YitamTools instance
    global.yitamTools = new YitamTools(dbService);
    
    // Create an MCP server
    const server = new Server({
      name: "yitam-server",
      version: "1.0.0",
      capabilities: {
        tools: {
          // Include the actual tools data in the correct format
          ...global.yitamTools.getTools().reduce((acc: Record<string, any>, tool) => {
            acc[tool.name] = {
              description: tool.description,
              inputSchema: tool.inputSchema
            };
            return acc;
          }, {})
        },
        incremental: true,
        streamable: true,
      }
    });
    
    // Register request handlers
    server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
    server.setRequestHandler(CallToolRequestSchema, callToolHandler);
    
    // Always start Stdio transport
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("YITAM Server running on stdio");
    
    // Start HTTP transport if enabled
    if (process.env.HTTP_SERVER === "true") {
      const port = parseInt(process.env.PORT || '3000', 10);
      const host = process.env.HTTP_HOST || '127.0.0.1';
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
      
      // Use our refactored HTTP transport
      const httpTransport = new StreamableHttpTransport({
        port,
        host,
        allowedOrigins,
      });
      
      await httpTransport.connect(server);
      console.log(`YITAM HTTP Server running with Streamable HTTP transport`);
    }
  } catch (error) {
    console.error('Error during server initialization:', error);
    process.exit(1);
  }
}

// Run the server
runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});

// Global type definition for yitamTools
declare global {
  var yitamTools: YitamTools;
} 