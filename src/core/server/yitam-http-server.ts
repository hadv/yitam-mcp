#!/usr/bin/env node

// Import globals first to ensure they're available
import '../types/globals';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { DatabaseService } from '../../services/database/database-service';
import { YitamTool } from '../../types/declarations/retrieval';
import { StreamableHttpTransport } from '../transport/http-transport';
import { YitamTools } from './yitam-tools';

// Load environment variables
dotenv.config();

// Helper functions for server operations
async function listToolsHandler() {
  const tools = global.yitamTools.getTools();
  return { tools };
}

async function callToolHandler(request: any) {
  const { name, arguments: args } = request.params;
  
  const tool = global.yitamTools.getTools().find(t => t.name === name);
  if (!tool) {
    throw { 
      code: ErrorCode.InvalidParams, 
      message: `Tool not found: ${name}`
    };
  }
  
  // Parse arguments to match the expected format
  const toolArgs = {
    query: args?.query,
    domains: Array.isArray(args?.domains) ? args.domains : (args?.domains ? [args.domains] : undefined),
    limit: typeof args?.limit === 'number' ? args.limit : undefined,
    scoreThreshold: typeof args?.scoreThreshold === 'number' ? args.scoreThreshold : undefined
  };
  
  const result = await tool.handler(toolArgs);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }]
  };
}

async function runServer() {
  try {
    // Initialize database service
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Create YitamTools instance
    global.yitamTools = new YitamTools(dbService);
    
    // Get configuration from environment variables
    const port = parseInt(process.env.PORT || '8080', 10);
    const host = process.env.HOST || '127.0.0.1';
    
    // Create an MCP server
    const server = new Server({
      name: 'yitam-mcp',
      version: '1.0.0',
      capabilities: {
        tools: {
          // Populate tools from YitamTools
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