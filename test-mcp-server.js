#!/usr/bin/env node

const http = require('http');
const { parse: parseUrl } = require('url');

// Sample tools data from our YitamTools implementation
const tools = [
  {
    name: 'query_domain_knowledge',
    description: 'Search and retrieve domain-specific knowledge using semantic similarity.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { 
          type: 'string', 
          description: 'The search query for retrieving domain knowledge' 
        },
        domains: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'List of specific domains to search within (optional)'
        },
        limit: { 
          type: 'number', 
          default: 10, 
          description: 'Number of results to retrieve (max 20)' 
        },
        scoreThreshold: { 
          type: 'number', 
          default: 0.7, 
          description: 'Minimum similarity score threshold (0-1)' 
        }
      },
      required: ['query']
    }
  }
];

// Server information
const serverInfo = {
  name: 'yitam-mcp-server',
  version: '1.0.0'
};

// Server capabilities with tools
const serverCapabilities = {
  tools: {
    query_domain_knowledge: {
      description: tools[0].description,
      inputSchema: tools[0].inputSchema
    }
  },
  incremental: true,
  streamable: true
};

// Session management
const sessions = new Map();

// Read request body as string
const readBody = async (req) => {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
  });
};

// Parse JSON safely
const parseJson = (text) => {
  try {
    return { success: true, data: JSON.parse(text) };
  } catch (error) {
    return { success: false, error };
  }
};

// Create HTTP server
const server = http.createServer(async (req, res) => {
  try {
    // Handle only requests to /mcp endpoint
    const parsedUrl = parseUrl(req.url);
    if (parsedUrl.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    // Get session from headers
    const sessionId = req.headers['mcp-session-id'];
    let session = sessionId ? sessions.get(sessionId) : undefined;

    // Process based on HTTP method
    switch (req.method) {
      case 'POST': {
        // Read and parse request body
        const body = await readBody(req);
        const parsed = parseJson(body);
        
        if (!parsed.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null
          }));
          return;
        }
        
        // Handle batch or single request
        const messages = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
        
        // Process messages
        const results = [];
        let isInit = false;
        
        for (const msg of messages) {
          if (msg.method === 'initialize') {
            isInit = true;
            
            // Create new session
            const newSessionId = Math.random().toString(36).substring(2, 15);
            sessions.set(newSessionId, {
              id: newSessionId,
              createdAt: Date.now(),
              clientInfo: msg.params?.clientInfo
            });
            
            // Set session header for response
            res.setHeader('Mcp-Session-Id', newSessionId);
            session = { id: newSessionId };
            
            // Create response
            results.push({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                serverInfo,
                capabilities: serverCapabilities
              }
            });
          } else if (msg.method === 'listTools') {
            results.push({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                tools
              }
            });
          } else if (msg.method === 'callTool') {
            const toolName = msg.params?.name;
            const args = msg.params?.arguments;
            
            if (toolName === 'query_domain_knowledge' && args?.query) {
              // Simulate query results
              const domains = args.domains || [];
              const domainsText = domains.length > 0 ? 
                ` from domains: ${domains.join(', ')}` : '';
              
              results.push({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      results: [
                        {
                          document: `Vietnamese traditional medicine (Đông y) is a comprehensive medical system that has evolved over thousands of years. Query: "${args.query}"${domainsText}. It emphasizes balance between yin and yang, as well as harmony with the five elements (wood, fire, earth, metal, water).`,
                          score: 0.95,
                          metadata: { domain: "đông y" }
                        },
                        {
                          document: `Y học cổ truyền incorporates herbal remedies, acupuncture, massage (tuina), and dietary therapy. It focuses on treating the root cause of illness rather than just symptoms.`,
                          score: 0.89,
                          metadata: { domain: "y học cổ truyền" }
                        }
                      ]
                    })
                  }]
                }
              });
            } else {
              results.push({
                jsonrpc: '2.0',
                id: msg.id,
                error: {
                  code: -32601,
                  message: `Tool not found or invalid arguments: ${toolName}`
                }
              });
            }
          } else {
            results.push({
              jsonrpc: '2.0',
              id: msg.id,
              error: {
                code: -32601,
                message: `Method not found: ${msg.method}`
              }
            });
          }
        }
        
        // Send response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results.length === 1 && !Array.isArray(parsed.data) ? results[0] : results));
        break;
      }
      
      case 'GET': {
        // Handle SSE for streaming
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        
        // Send initial connection message
        res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
        
        // Keep connection alive
        const keepAliveInterval = setInterval(() => {
          res.write(`:keepalive\n\n`);
        }, 30000);
        
        // Close connection on client disconnect
        req.on('close', () => {
          clearInterval(keepAliveInterval);
        });
        
        break;
      }
      
      case 'DELETE': {
        // Handle session deletion
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Mcp-Session-Id header is required');
          return;
        }
        
        if (sessions.has(sessionId)) {
          sessions.delete(sessionId);
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Session not found');
        }
        break;
      }
      
      default: {
        res.writeHead(405, {
          'Content-Type': 'text/plain',
          'Allow': 'GET, POST, DELETE'
        });
        res.end('Method Not Allowed');
      }
    }
  } catch (error) {
    console.error('Error handling request:', error);
    
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`MCP Server running at http://127.0.0.1:${PORT}/mcp`);
});

// Handle server shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}); 