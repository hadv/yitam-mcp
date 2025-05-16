import * as http from 'http';
import * as url from 'url';
import { EventEmitter } from 'events';
import { 
  Server
} from "@modelcontextprotocol/sdk/server/index.js";
import { 
  SSEServerTransport 
} from "@modelcontextprotocol/sdk/server/sse.js";
import {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResponse,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { SessionManager, Session } from './session-manager';

// Constants
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = '127.0.0.1';
const MCP_ENDPOINT = '/mcp';

// Utility types for HTTP transport
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

// Type guards for JSON-RPC message handling
const isJsonRpcRequest = (message: JSONRPCMessage): message is JSONRPCRequest => 
  'method' in message && 'id' in message && message.id !== null && message.id !== undefined;

const isJsonRpcNotification = (message: JSONRPCMessage): message is JSONRPCNotification => 
  'method' in message && ('id' in message === false || message.id === null || message.id === undefined);

// Utility for safe JSON parsing
function tryParseJson(str: string): { success: boolean; value?: any; error?: Error } {
  try {
    const value = JSON.parse(str);
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}

/**
 * Implementation of a Streamable HTTP Transport for MCP Server.
 * This class handles HTTP message transport according to the MCP specification:
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 */
export class StreamableHttpTransport extends EventEmitter {
  private server: Server | null = null;
  private httpServer: http.Server | null = null;
  private sessions = new SessionManager();
  private pendingResponses = new Map<string, JSONRPCResponse[]>();
  private sseEventCounter = 0;
  
  // SSE transport instances mapped by session ID
  private sseTransports = new Map<string, SSEServerTransport>();
  
  private readonly options: Required<HttpTransportOptions>;
  
  constructor(options: HttpTransportOptions = {}) {
    super();
    this.options = {
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? DEFAULT_HOST,
      sessionTimeoutMs: options.sessionTimeoutMs ?? 24 * 60 * 60 * 1000, // 24 hours
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
    
    // Create HTTP server
    this.httpServer = http.createServer(this.handleRequest.bind(this));
    
    // Start HTTP server
    await new Promise<void>((resolve, reject) => {
      if (!this.httpServer) return reject(new Error('HTTP server not initialized'));
      
      this.httpServer.on('error', (err) => {
        console.error('HTTP Server error:', err);
        reject(err);
      });
      
      this.httpServer.listen(this.options.port, this.options.host, () => {
        console.log(`MCP HTTP Server listening on ${this.options.host}:${this.options.port}`);
        resolve();
      });
    });
  }

  /**
   * Close the HTTP server and clean up resources
   */
  async close(): Promise<void> {
    // Close all SSE connections
    this.sseTransports.forEach(transport => {
      transport.close().catch(err => {
        console.error('Error closing SSE transport:', err);
      });
    });
    
    // Clean up sessions
    this.sessions.stop();
    
    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    
    this.server = null;
    this.httpServer = null;
  }

  /**
   * Main HTTP request handler
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // CORS handling
      if (req.method === 'OPTIONS') {
        this.handleCorsPreflightRequest(req, res);
        return;
      }
      
      // Set CORS headers for all responses
      this.setCorsHeaders(req, res);
      
      // Check if the request is for the MCP endpoint
      const parsedUrl = url.parse(req.url || '', true);
      if (!parsedUrl.pathname?.startsWith(MCP_ENDPOINT)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      
      // Extract session ID from query parameters
      const sessionId = parsedUrl.query.sessionId as string | undefined;
      let session: Session | undefined;
      
      if (sessionId) {
        // Validate the session if a session ID is provided
        if (!this.sessions.isSessionValid(sessionId)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired session' }));
          return;
        }
        
        session = this.sessions.getSession(sessionId);
      }
      
      // Route based on HTTP method
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
          res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, POST, DELETE, OPTIONS' });
          res.end('Method Not Allowed');
      }
    } catch (error) {
      console.error('Error handling HTTP request:', error);
      
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  }
  
  /**
   * Handle HTTP POST requests (client to server messages)
   */
  private async handlePostRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    session?: Session
  ): Promise<void> {
    // Check content type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      res.writeHead(415, { 'Content-Type': 'text/plain' });
      res.end('Unsupported Media Type: Content-Type must be application/json');
      return;
    }
    
    // Read request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    
    const body = Buffer.concat(chunks).toString('utf8');
    const parseResult = tryParseJson(body);
    
    if (!parseResult.success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    
    let messages: JSONRPCMessage[];
    
    // Handle either a single message or an array of messages
    if (Array.isArray(parseResult.value)) {
      messages = parseResult.value;
    } else {
      messages = [parseResult.value];
    }
    
    // Check if this is an initialization request
    const isInitializationRequest = messages.some(msg => 
      isJsonRpcRequest(msg) && msg.method === 'initialize'
    );
    
    // Create a new session if this is an initialization request and no session exists
    if (isInitializationRequest && !session) {
      session = this.sessions.createSession();
    }
    
    // Check if session exists at this point (either provided or created)
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'No valid session. Send an initialize request first.' 
      }));
      return;
    }
    
    // Get or create an SSE transport for this session
    let sseTransport = this.sseTransports.get(session.id);
    
    if (!sseTransport) {
      const sseEndpoint = `${MCP_ENDPOINT}/sse`;
      sseTransport = new SSEServerTransport(sseEndpoint, res);
      // Connect the transport to the server
      await this.server?.connect(sseTransport);
      
      this.sseTransports.set(session.id, sseTransport);
    }
    
    // Process each message
    for (const message of messages) {
      try {
        // If this is a notification or request, forward it through the SSE transport
        if (isJsonRpcRequest(message) || isJsonRpcNotification(message)) {
          await sseTransport.handleMessage(message);
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }
    
    // Set the appropriate response
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'accepted',
      sessionId: session.id
    }));
  }

  /**
   * Handle HTTP GET requests (server-to-client streaming)
   */
  private async handleGetRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    session?: Session
  ): Promise<void> {
    // Session must exist for GET requests
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'No valid session. Send an initialize request first.'
      }));
      return;
    }
    
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    // Get or create an SSE transport
    let sseTransport = this.sseTransports.get(session.id);
    
    if (!sseTransport) {
      const sseEndpoint = `${MCP_ENDPOINT}/sse`;
      sseTransport = new SSEServerTransport(sseEndpoint, res);
      // Connect the transport to the server
      await this.server?.connect(sseTransport);
      
      this.sseTransports.set(session.id, sseTransport);
      
      // Start the SSE connection
      await sseTransport.start();
    } else {
      // Send an initial message to confirm connection
      res.write(`event: connected\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
    }
    
    // Add cleanup when client disconnects
    res.on('close', () => {
      this.sseTransports.delete(session.id);
    });
  }

  /**
   * Handle HTTP DELETE requests (session termination)
   */
  private async handleDeleteRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    sessionId?: string
  ): Promise<void> {
    // Session ID is required for DELETE
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Session ID is required for DELETE requests' 
      }));
      return;
    }
    
    // Close any SSE transport for this session
    const sseTransport = this.sseTransports.get(sessionId);
    if (sseTransport) {
      await sseTransport.close().catch(err => {
        console.error('Error closing SSE transport:', err);
      });
      this.sseTransports.delete(sessionId);
    }
    
    // Delete the session
    const success = this.sessions.deleteSession(sessionId);
    
    if (success) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'session terminated' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
  }
  
  /**
   * Set CORS headers for all responses
   */
  private setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    
    // If origin is allowed, set Access-Control-Allow-Origin
    if (origin && this.isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (this.options.allowedOrigins.length === 0) {
      // If no allowed origins are specified, allow all
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  /**
   * Handle CORS preflight requests
   */
  private handleCorsPreflightRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setCorsHeaders(req, res);
    res.writeHead(204);
    res.end();
  }
  
  /**
   * Check if an origin is allowed
   */
  private isOriginAllowed(origin: string): boolean {
    if (this.options.allowedOrigins.length === 0) {
      return true; // Allow all origins if none specified
    }
    
    return this.options.allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin === '*') {
        return true;
      }
      
      return origin === allowedOrigin || 
        (allowedOrigin.endsWith('*') && 
         origin.startsWith(allowedOrigin.slice(0, -1)));
    });
  }
  
  // Methods required by ServerTransport interface
  
  /**
   * Start method required by ServerTransport interface
   * (Not used directly - connection is established through the connect method)
   */
  async start(): Promise<void> {
    // This is handled in the connect method
  }
  
  /**
   * Send a message to a client
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.server) {
      throw new Error('Transport not connected to server');
    }
    
    // In our implementation, messages are actually sent by the SSE transports
    // This method is here to satisfy the ServerTransport interface
  }
  
  /**
   * SessionId getter for ServerTransport interface
   * This is not used directly in our implementation since we manage multiple sessions
   */
  get sessionId(): string | undefined {
    return undefined;
  }
  
  /**
   * Event handlers for ServerTransport interface
   */
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: unknown) => void;
} 