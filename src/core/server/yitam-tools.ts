#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResponse,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { DatabaseService } from '../../services/database/database-service';
import { FormattedResult } from '../../types/qdrant';
import { YitamTool, RetrievalConfig, RetrievalArgs } from '../../types/declarations/retrieval';
import * as http from 'http';
import * as crypto from 'crypto';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Load environment variables
dotenv.config();

// Constants
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const MCP_ENDPOINT = '/mcp';

// Utility types
/** Custom type to correctly handle JSONRPC error responses */
interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Utility types for HTTP transport
interface Session {
  id: string;
  createdAt: number;
  lastAccessed: number;
  clientInfo?: any;
  requestStreams: Map<string, http.ServerResponse>;
}

interface HttpTransportOptions {
  port?: number;
  host?: string;
  sessionTimeoutMs?: number;
  allowedOrigins?: string[];
  sslOptions?: {
    key: string;
    cert: string;
  };
}

// Utility to generate a secure session ID
const generateSecureId = () => crypto.randomBytes(16).toString('hex');

// Type guards for JSON-RPC message handling
const isJsonRpcRequest = (message: JSONRPCMessage): message is JSONRPCRequest => 
  'method' in message && 'id' in message && message.id !== null && message.id !== undefined;

const isJsonRpcNotification = (message: JSONRPCMessage): message is JSONRPCNotification => 
  'method' in message && ('id' in message === false || message.id === null || message.id === undefined);

const isJsonRpcResponse = (message: JSONRPCMessage): message is JSONRPCResponse => 
  'result' in message || 'error' in message;

// Utility for safe JSON parsing
function tryParseJson(str: string): { success: boolean; value?: any; error?: Error } {
  try {
    const value = JSON.parse(str);
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

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

/**
 * Implementation of a Streamable HTTP Transport for MCP Server.
 * This class handles HTTP message transport according to the MCP specification:
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 */
class StreamableHttpTransport extends EventEmitter {
  private server: Server | null = null;
  private httpServer: http.Server | null = null;
  private sessions = new Map<string, Session>();
  private pendingResponses = new Map<string, JSONRPCResponse[]>();
  private sseEventCounter = 0;
  private sessionCleanupInterval: NodeJS.Timeout | null = null;
  private readonly options: Required<HttpTransportOptions>;
  private serverInfo: any;
  private serverCapabilities: any;
  
  constructor(options: HttpTransportOptions = {}) {
    super();
    this.options = {
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? DEFAULT_HOST,
      sessionTimeoutMs: options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
      allowedOrigins: options.allowedOrigins ?? [],
      sslOptions: options.sslOptions ?? { key: '', cert: '' }
    };
  }

  /**
   * Connect this transport to an MCP Server instance
   */
  async connect(server: Server): Promise<void> {
    if (this.server) {
      throw new Error('HTTP Transport already connected to a server');
    }
    
    this.server = server;
    
    // Store server info and capabilities for initialization responses
    this.serverInfo = serverInfo;
    this.serverCapabilities = serverCapabilities;
    
    // Create HTTP server
    this.httpServer = http.createServer(this.handleRequest.bind(this));
    
    // Set up session cleanup
    this.sessionCleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000); // Check every minute
    
    // Start HTTP server
    await new Promise<void>((resolve, reject) => {
      if (!this.httpServer) return reject(new Error('HTTP server not initialized'));
      
      this.httpServer.on('error', (err) => {
        console.error('HTTP Server error:', err);
        reject(err);
      });
      
      const useSSL = this.options.sslOptions.key && this.options.sslOptions.cert;
      const protocol = useSSL ? 'https' : 'http';
      
      if (useSSL) {
        const sslOptions = {
          key: fs.readFileSync(this.options.sslOptions.key),
          cert: fs.readFileSync(this.options.sslOptions.cert)
        };
        // SSL implementation would go here
        // For now, we're just using plain HTTP
      }
      
      this.httpServer.listen(this.options.port, this.options.host, () => {
        console.log(`Streamable HTTP Transport running on ${protocol}://${this.options.host}:${this.options.port}${MCP_ENDPOINT}`);
        resolve();
      });
    });
    
    // Handle server shutdown
    process.on('SIGINT', () => this.close());
    process.on('SIGTERM', () => this.close());
  }
  
  /**
   * Close the transport and clean up resources
   */
  async close(): Promise<void> {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
    
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        if (!this.httpServer) return resolve();
        this.httpServer.close(() => resolve());
      });
      this.httpServer = null;
    }
    
    this.sessions.clear();
    this.pendingResponses.clear();
    this.server = null;
  }
  
  /**
   * Main request handler for HTTP server
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    
    // Only handle requests to MCP endpoint
    if (pathname !== MCP_ENDPOINT) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    
    // Validate Origin header to prevent DNS rebinding attacks
    if (!this.validateOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden - Origin not allowed');
      return;
    }
    
    // Get session info
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    
    // Handle request based on method
    switch (req.method) {
      case 'POST':
        await this.handlePostRequest(req, res, session);
        break;
      case 'GET':
        await this.handleGetRequest(req, res, session);
        break;
      case 'DELETE':
        await this.handleDeleteRequest(req, res, sessionId);
        break;
      default:
        res.writeHead(405, { 
          'Content-Type': 'text/plain',
          'Allow': 'POST, GET, DELETE'
        });
        res.end('Method Not Allowed');
    }
  }
  
  /**
   * Handle POST requests for sending messages to the server
   */
  private async handlePostRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    session?: Session
  ): Promise<void> {
    // Validate Accept header
    const acceptHeader = req.headers['accept'] || '';
    if (!acceptHeader || (!acceptHeader.includes('application/json') && !acceptHeader.includes('text/event-stream'))) {
      res.writeHead(406, { 'Content-Type': 'text/plain' });
      res.end('Not Acceptable: Client must accept application/json or text/event-stream');
      return;
    }
    
    // Read the request body
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
    }
    
    // Parse the request body
    const parseResult = tryParseJson(body);
    if (!parseResult.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { 
          code: ErrorCode.ParseError, 
          message: "Parse error" 
        },
        id: null
      }));
      return;
    }
    
    const message = parseResult.value;
    const messages = Array.isArray(message) ? message : [message];
    
    // Process the messages
    try {
      // Check for initialize requests
      let isInitializeRequest = false;
      let hasAnyRequest = false;
      
      for (const msg of messages) {
        if (isJsonRpcRequest(msg)) {
          hasAnyRequest = true;
          if (msg.method === 'initialize') {
            isInitializeRequest = true;
            break;
          }
        }
      }
      
      // Validate session for non-initialize requests
      if (!isInitializeRequest && hasAnyRequest && !session) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { 
            code: ErrorCode.InvalidRequest, 
            message: "Session required for non-initialize requests" 
          },
          id: null
        }));
        return;
      }
      
      // Check if all messages are notifications or responses
      const containsOnlyNotificationsOrResponses = messages.every(
        msg => isJsonRpcNotification(msg) || isJsonRpcResponse(msg)
      );
      
      if (containsOnlyNotificationsOrResponses) {
        // Process the messages with the server
        for (const msg of messages) {
          await this.processMessageWithServer(msg, session?.id);
        }
        
        // Return 202 Accepted
        res.writeHead(202);
        res.end();
        return;
      }
      
      // Process initialize requests
      if (isInitializeRequest) {
        // Create a new session
        const newSessionId = generateSecureId();
        const newSession: Session = {
          id: newSessionId,
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          requestStreams: new Map()
        };
        this.sessions.set(newSessionId, newSession);
        
        // Set the session header
        res.setHeader('Mcp-Session-Id', newSessionId);
        session = newSession;
      }
      
      // Update session access time
      if (session) {
        session.lastAccessed = Date.now();
      }
      
      // Process requests asynchronously and send responses
      if (acceptHeader.includes('text/event-stream')) {
        // Use SSE for responses
        await this.handlePostWithSSE(req, res, messages, session);
      } else {
        // Use JSON for responses
        await this.handlePostWithJson(req, res, messages, session);
      }
    } catch (error) {
      console.error('Error processing POST request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { 
          code: ErrorCode.InternalError, 
          message: error instanceof Error ? error.message : "Internal server error" 
        },
        id: null
      }));
    }
  }
  
  /**
   * Handle POST requests with SSE responses
   */
  private async handlePostWithSSE(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    messages: JSONRPCMessage[], 
    session?: Session
  ): Promise<void> {
    if (!this.server || !session) {
      throw new Error('Server or session not available');
    }
    
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    // Create a unique stream identifier for this request
    const streamId = `stream-${generateSecureId()}`;
    session.requestStreams.set(streamId, res);
    
    // Track pending requests
    const requestIds = new Set<string | number>();
    for (const msg of messages) {
      if (isJsonRpcRequest(msg)) {
        requestIds.add(msg.id);
      }
    }
    
    // Process each message
    for (const msg of messages) {
      await this.processMessageWithServer(msg, session.id);
    }
    
    // Set up a listener for responses
    const responseListener = (response: JSONRPCMessage, targetSession: string) => {
      if (targetSession === session?.id && 'id' in response && requestIds.has(response.id)) {
        // Send the response as an SSE event
        this.sseEventCounter++;
        res.write(`id: ${this.sseEventCounter}\n`);
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        
        // Remove from pending requests
        requestIds.delete(response.id);
        
        // If all requests have been responded to, close the stream
        if (requestIds.size === 0) {
          if (!res.destroyed) {
            res.end();
          }
          
          // Clean up
          this.off('response', responseListener);
          if (session) {
            session.requestStreams.delete(streamId);
          }
        }
      }
    };
    
    // Listen for responses
    this.on('response', responseListener);
    
    // Handle disconnection
    req.on('close', () => {
      this.off('response', responseListener);
      if (session) {
        session.requestStreams.delete(streamId);
      }
    });
    
    // If somehow we got no request IDs to track (only notifications), close immediately
    if (requestIds.size === 0) {
      res.end();
    }
  }
  
  /**
   * Handle POST requests with JSON responses
   */
  private async handlePostWithJson(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    messages: JSONRPCMessage[], 
    session?: Session
  ): Promise<void> {
    if (!this.server) {
      throw new Error('Server not available');
    }
    
    // Track request IDs that need responses
    const requestIds = new Map<string | number, boolean>();
    for (const msg of messages) {
      if (isJsonRpcRequest(msg)) {
        requestIds.set(msg.id, false);
      }
    }
    
    // If no requests, just send 202
    if (requestIds.size === 0) {
      res.writeHead(202);
      res.end();
      return;
    }
    
    // Create a collection for responses
    const responses: JSONRPCMessage[] = [];
    
    // Process each message and collect responses
    for (const msg of messages) {
      const response = await this.processMessageWithServer(msg, session?.id);
      if (response) {
        responses.push(response);
        
        // TypeScript needs help understanding the structure here
        const responseWithId = response as { id?: string | number };
        if (responseWithId.id !== undefined && responseWithId.id !== null) {
          requestIds.set(responseWithId.id, true);
        }
      }
    }
    
    // Check if we got all expected responses
    const missingResponses = Array.from(requestIds.entries())
      .filter(([_, received]) => !received)
      .map(([id]) => id);
    
    if (missingResponses.length > 0) {
      console.warn(`Missing responses for request IDs: ${missingResponses.join(', ')}`);
    }
    
    // Send the responses
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    if (responses.length === 1 && !Array.isArray(messages)) {
      // Single request, single response
      res.end(JSON.stringify(responses[0]));
    } else {
      // Batch requests or responses
      res.end(JSON.stringify(responses));
    }
  }
  
  /**
   * Handle GET requests for server-to-client communication via SSE
   */
  private async handleGetRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    session?: Session
  ): Promise<void> {
    // Validate Accept header
    const acceptHeader = req.headers['accept'] || '';
    if (!acceptHeader || !acceptHeader.includes('text/event-stream')) {
      res.writeHead(406, { 'Content-Type': 'text/plain' });
      res.end('Not Acceptable: Client must accept text/event-stream for GET requests');
      return;
    }
    
    // Validate session
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized: Valid Mcp-Session-Id required for GET stream');
      return;
    }
    
    // Update session access time
    session.lastAccessed = Date.now();
    
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    // Create a unique stream identifier for this GET request
    const streamId = `notify-${generateSecureId()}`;
    session.requestStreams.set(streamId, res);
    
    // Handle Last-Event-ID header for resuming
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      // Implement resumability: replay any missed events since lastEventId
      console.log(`Client requests to resume from event ID: ${lastEventId}`);
    }
    
    // Send initial connection event
    this.sseEventCounter++;
    res.write(`id: ${this.sseEventCounter}\n`);
    res.write(`event: mcp-server-connected\n`);
    res.write(`data: {"message":"SSE connection established for session ${session.id}"}\n\n`);
    
    // Set up listener for server-initiated messages
    const messageListener = (message: JSONRPCMessage, targetSession: string) => {
      if (targetSession === session?.id && !res.destroyed) {
        this.sseEventCounter++;
        res.write(`id: ${this.sseEventCounter}\n`);
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      }
    };
    
    // Register the listener
    this.on('serverMessage', messageListener);
    
    // Handle client disconnection
    req.on('close', () => {
      this.off('serverMessage', messageListener);
      if (session) {
        session.requestStreams.delete(streamId);
      }
    });
  }
  
  /**
   * Handle DELETE requests for terminating sessions
   */
  private async handleDeleteRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    sessionId?: string
  ): Promise<void> {
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Mcp-Session-Id header is required for DELETE');
      return;
    }
    
    // Attempt to remove the session
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      
      // Close all open streams for this session
      for (const [streamId, streamRes] of session.requestStreams.entries()) {
        if (!streamRes.destroyed) {
          streamRes.end();
        }
      }
      
      // Remove the session
      this.sessions.delete(sessionId);
      console.log(`Session terminated: ${sessionId}`);
      
      res.writeHead(204); // No Content
      res.end();
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Session not found');
    }
  }
  
  /**
   * Process a message with the MCP server and return the response
   */
  private async processMessageWithServer(
    message: JSONRPCMessage, 
    sessionId?: string
  ): Promise<JSONRPCMessage | null> {
    if (!this.server) {
      throw new Error('Server not available');
    }
    
    // For requests or notifications, determine the MCP method and call appropriate handler
    if (isJsonRpcRequest(message) || isJsonRpcNotification(message)) {
      try {
        // The actual way to invoke server methods would depend on the SDK
        const response = await this.invokeServerMethod(message, sessionId);
        
        if (response) {
          this.emit('response', response, sessionId || '');
          return response;
        }
        
        return null;
      } catch (error) {
        console.error(`Error processing message ${message.method}:`, error);
        
        if (isJsonRpcRequest(message)) {
          // Create a proper error response object
          const errorResponse: JSONRPCMessage = {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: ErrorCode.InternalError,
              message: error instanceof Error ? error.message : "Internal server error"
            }
          };
          
          this.emit('response', errorResponse, sessionId || '');
          return errorResponse;
        }
      }
    } else if (isJsonRpcResponse(message)) {
      // Handle incoming responses (e.g., from client callbacks)
      console.log(`Received response with ID ${message.id}`);
    }
    
    return null;
  }
  
  /**
   * Invoke a method on the MCP server
   */
  private async invokeServerMethod(
    message: JSONRPCRequest | JSONRPCNotification, 
    sessionId?: string
  ): Promise<JSONRPCMessage | null> {
    if (!this.server) throw new Error('Server not available');
    
    const method = message.method;
    const params = message.params || {};
    
    try {
      // First handle notifications
      if (isJsonRpcNotification(message)) {
        if (method === 'cancelled') {
          console.log('Request cancelled:', params);
        }
        return null; // No response for notifications
      }
      
      // At this point, we know it's a request
      const request = message as JSONRPCRequest; // Safe cast
      
      // Handle request methods
      switch (method) {
        case 'listTools': {
          const result = await listToolsHandler();
          return {
            jsonrpc: "2.0",
            id: request.id,
            result
          };
        }
        
        case 'callTool': {
          const result = await callToolHandler({ params, method });
          return {
            jsonrpc: "2.0",
            id: request.id,
            result
          };
        }
        
        case 'initialize': {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              capabilities: this.serverCapabilities.capabilities,
              serverInfo: this.serverInfo
            }
          };
        }
        
        default: {
          // Method not found
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: ErrorCode.MethodNotFound,
              message: `Method not found: ${method}`
            }
          };
        }
      }
    } catch (error) {
      // Handle error for request
      return {
        jsonrpc: "2.0",
        id: (message as JSONRPCRequest).id,
        error: {
          code: ErrorCode.InternalError,
          message: error instanceof Error ? error.message : "Internal server error"
        }
      };
    }
  }
  
  /**
   * Send a server-initiated message to a client
   */
  public sendMessageToClient(message: JSONRPCMessage, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`Attempted to send message to non-existent session: ${sessionId}`);
      return;
    }
    
    // Emit the event, which will be picked up by active SSE listeners
    this.emit('serverMessage', message, sessionId);
    
    // If it's a response, also emit the response event for POST-initiated SSE streams
    if (isJsonRpcResponse(message)) {
      this.emit('response', message, sessionId);
    }
  }
  
  /**
   * Validate the Origin header to prevent DNS rebinding attacks
   */
  private validateOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    
    // If no allowed origins are configured, or this is a local request without an origin, allow
    if (this.options.allowedOrigins.length === 0) {
      return true;
    }
    
    // If origin is present, check against allowed list
    if (origin) {
      return this.options.allowedOrigins.some(allowed => {
        if (allowed === '*') return true;
        return origin === allowed;
      });
    }
    
    // No origin header, this is likely a direct API call rather than a browser request
    return true;
  }
  
  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredIds: string[] = [];
    
    // Find expired sessions
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccessed > this.options.sessionTimeoutMs) {
        expiredIds.push(id);
      }
    }
    
    // Clean up expired sessions
    for (const id of expiredIds) {
      const session = this.sessions.get(id);
      if (session) {
        // Close any open streams
        for (const [streamId, res] of session.requestStreams.entries()) {
          if (!res.destroyed) {
            res.end();
          }
        }
        
        // Remove the session
        this.sessions.delete(id);
        console.log(`Session expired and removed: ${id}`);
      }
    }
  }
}

// Helper functions for server operations
async function listToolsHandler() {
  return {
    tools: yitamTools.getTools(),
  };
}

async function callToolHandler(request: any) {
  const { name, arguments: args } = request.params;
  
  try {
    const tool = yitamTools.getTools().find(t => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!args?.query) {
      throw new Error('Query parameter is required');
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
    throw error;
  }
}

// Service initialization
const dbService = new DatabaseService();
const yitamTools = new YitamTools(dbService);

// Server setup
const serverInfo = {
  name: "yitam-server",
  version: "1.0.0",
};

// Format tools for server capabilities
const serverCapabilities = {
  capabilities: {
    tools: {
      // Include the actual tools data in the correct format
      ...yitamTools.getTools().reduce((acc: Record<string, any>, tool) => {
        acc[tool.name] = {
          description: tool.description,
          inputSchema: tool.inputSchema
        };
        return acc;
      }, {})
    },
    // ... any other capabilities defined by your server
  },
};

const server = new Server(
  serverInfo,
  serverCapabilities
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
    
    // Start transports
    
    // Always start Stdio transport
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("YITAM Server running on stdio");
    
    // Start HTTP transport if enabled
    if (process.env.HTTP_SERVER === "true") {
      const port = parseInt(process.env.PORT || '3000', 10);
      const host = process.env.HTTP_HOST || '127.0.0.1';
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
      
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

runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
}); 