#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { DatabaseService } from '../../services/database/database-service';
import { FormattedResult, DEFAULT_HYBRID_SEARCH_WEIGHTS, HybridSearchOptions } from '../../types/qdrant';
import { YitamTool, RetrievalConfig, RetrievalArgs, HybridRetrievalArgs } from '../../types/declarations/retrieval';
import express from 'express';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Import the express types directly from the modules
import type { Request, Response } from 'express-serve-static-core';

class YitamTools {
  private readonly config: RetrievalConfig;

  constructor(
    private readonly dbService: DatabaseService,
    config?: Partial<RetrievalConfig>
  ) {
    this.config = {
      defaultLimit: 6,
      minScoreThreshold: 0.7,
      maxResults: 10,
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

  private validateHybridSearchParams(
    limit: number, 
    scoreThreshold: number, 
    denseWeight?: number, 
    sparseWeight?: number
  ): void {
    this.validateSearchParams(limit, scoreThreshold);
    
    if (denseWeight !== undefined && (denseWeight < 0 || denseWeight > 1)) {
      throw new Error('Dense weight must be between 0 and 1');
    }
    
    if (sparseWeight !== undefined && (sparseWeight < 0 || sparseWeight > 1)) {
      throw new Error('Sparse weight must be between 0 and 1');
    }
    
    // If both are provided, they should sum to 1
    if (denseWeight !== undefined && sparseWeight !== undefined) {
      const sum = denseWeight + sparseWeight;
      if (sum < 0.99 || sum > 1.01) { // Allow small floating point errors
        throw new Error('Dense weight and sparse weight should sum to 1');
      }
    }
  }

  private async performSearch(query: string, limit: number, scoreThreshold: number, domains?: string[]): Promise<FormattedResult[]> {
    return await this.dbService.search(query, limit, scoreThreshold, domains);
  }

  private async performHybridSearch(
    query: string, 
    options: HybridSearchOptions
  ): Promise<FormattedResult[]> {
    return await this.dbService.hybridSearch(query, options);
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
      },
      {
        name: 'hybrid_search_domain_knowledge',
        description: `Hybrid search for domain-specific knowledge combining semantic similarity and keyword matching.

This advanced search tool provides more accurate and contextually relevant results by blending two search methodologies:
1. Dense vector search: Understands the semantic meaning behind your query (what you mean)
2. Sparse vector search: Performs keyword matching (what specific terms you use)

The hybrid approach excels at capturing both semantic understanding and specific terminology importance,
resulting in more precise and comprehensive search results.

You can optionally specify custom weights for each search method:
- denseWeight: Importance of semantic meaning (default 0.7)
- sparseWeight: Importance of keyword matching (default 0.3)

You can also filter by domains, just like in the standard search tool.

The results are ranked by a combined relevance score that considers both semantic similarity and keyword matching.`,
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
            denseWeight: {
              type: "number",
              default: DEFAULT_HYBRID_SEARCH_WEIGHTS.denseWeight,
              description: "Weight for semantic search component (0-1)"
            },
            sparseWeight: {
              type: "number",
              default: DEFAULT_HYBRID_SEARCH_WEIGHTS.sparseWeight,
              description: "Weight for keyword matching component (0-1)"
            }
          },
          required: ["query"],
        },
        handler: async ({ 
          query, 
          domains, 
          limit = this.config.defaultLimit, 
          scoreThreshold = this.config.minScoreThreshold,
          denseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.denseWeight,
          sparseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.sparseWeight
        }: HybridRetrievalArgs) => {
          try {
            this.validateHybridSearchParams(limit, scoreThreshold, denseWeight, sparseWeight);
            
            const results = await this.performHybridSearch(query, {
              limit,
              scoreThreshold,
              domains,
              denseWeight,
              sparseWeight
            });
            
            return { 
              success: true,
              results
            };
          } catch (error) {
            console.error('Error in hybrid_search_domain_knowledge:', error);
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

// Service initialization
const dbService = new DatabaseService();
const yitamTools = new YitamTools(dbService);

// Server setup
const server = new Server(
  {
    name: "yitam-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: yitamTools.getTools(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    const tool = yitamTools.getTools().find(t => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!args?.query) {
      throw new Error('Query parameter is required');
    }

    // Parse the arguments based on tool type
    const parsedArgs: RetrievalArgs = {
      query: String(args.query),
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      scoreThreshold: typeof args.scoreThreshold === 'number' ? args.scoreThreshold : undefined
    };
    
    // Add domain filter if provided
    if (Array.isArray(args.domains)) {
      parsedArgs.domains = args.domains.map(String);
    }
    
    // Add hybrid search specific parameters if present
    if (name === 'hybrid_search_domain_knowledge') {
      if (typeof args.denseWeight === 'number') {
        (parsedArgs as HybridRetrievalArgs).denseWeight = args.denseWeight;
      }
      if (typeof args.sparseWeight === 'number') {
        (parsedArgs as HybridRetrievalArgs).sparseWeight = args.sparseWeight;
      }
    }

    const result = await tool.handler(parsedArgs);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  } catch (error) {
    console.error(`Error during tool execution (${name}):`, error);
    return {
      content: [{ 
        type: "text", 
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      }],
      isError: true,
    };
  }
});

// Server startup
async function runServer() {
  try {
    // Initialize the database service
    await dbService.initialize();
    
    // Determine which transport to use based on env variables
    const transportMode = process.env.TRANSPORT_MODE || 'stdio';

    if (transportMode === 'sse') {
      // Setup Express for SSE transport
      const app = express();
      const port = parseInt(process.env.PORT || '3000', 10);
      
      // Enable CORS for all origins (can be restricted in production)
      app.use(cors());
      
      // Add basic health check endpoint
      app.get('/health', (_: Request, res: Response) => {
        res.status(200).send('OK');
      });
      
      // Create SSE endpoint
      let sseTransport: SSEServerTransport | null = null;
      
      app.get('/sse', (req: Request, res: Response) => {
        // Validate origin for security if needed
        const origin = req.headers.origin;
        console.log(`SSE connection requested from: ${origin}`);
        
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Connection', 'keep-alive');
        
        sseTransport = new SSEServerTransport('/messages', res);
        server.connect(sseTransport).catch(error => {
          console.error('Error connecting SSE transport:', error);
        });
        
        // Handle client disconnect
        req.on('close', () => {
          console.log('SSE connection closed');
          sseTransport = null;
        });
      });
      
      // Handle JSON-RPC messages
      app.post('/messages', express.json(), (req: Request, res: Response) => {
        if (sseTransport) {
          sseTransport.handlePostMessage(req, res);
        } else {
          res.status(400).json({ error: 'No active SSE connection' });
        }
      });
      
      // Start HTTP server
      const host = process.env.MCP_SERVER_HOST || 'localhost';
      app.listen(port, host, () => {
        console.log(`YITAM Server running with SSE transport on ${host}: ${port}`);
        console.log(`SSE endpoint: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/sse`);
        console.log(`Messages endpoint: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/messages`);
      });
    } else {
      // Default to stdio transport
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.log("YITAM Server running with stdio transport");
    }
  } catch (error) {
    console.error('Error during server initialization:', error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
}); 