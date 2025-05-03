#!/usr/bin/env node

/**
 * Simple HTTP client for interacting with the YITAM MCP server via SSE.
 * This client does not depend on any MCP libraries, showing how
 * external applications can use the API without MCP dependencies.
 */

const EventSource = require('eventsource');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

// Configuration
const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';
const SSE_ENDPOINT = `${SERVER_URL}/sse`;
const MESSAGES_ENDPOINT = `${SERVER_URL}/messages`;

// Track request IDs
const pendingRequests = new Map();

// Connect to SSE endpoint
function connectToServer() {
  console.log(`Connecting to MCP server at ${SSE_ENDPOINT}`);
  
  const eventSource = new EventSource(SSE_ENDPOINT);
  
  eventSource.onopen = () => {
    console.log('SSE connection established');
    
    // Initialize the server after connecting
    initialize().then(() => {
      // Example: Query domain knowledge after successful initialization
      queryDomainKnowledge('Lý giải về âm dương ngũ hành trong đông y').then(result => {
        console.log('Query result:', JSON.stringify(result, null, 2));
        
        // Close the connection after we're done
        eventSource.close();
        console.log('Connection closed');
        process.exit(0);
      });
    });
  };
  
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    // Handle message based on JSON-RPC structure
    if (message.id && pendingRequests.has(message.id)) {
      const { resolve, reject } = pendingRequests.get(message.id);
      
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
      
      // Remove from pending requests
      pendingRequests.delete(message.id);
    } else {
      // Handle notifications or unexpected messages
      console.log('Received message:', message);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
  };
  
  return eventSource;
}

// Send a request to the server
async function sendRequest(method, params) {
  const id = uuidv4();
  
  const requestPromise = new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    
    // Set a timeout to reject the promise if no response is received
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }
    }, 30000); // 30 second timeout
  });
  
  // Send the request using fetch
  const response = await fetch(MESSAGES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }
  
  // Return the promise that will be resolved when the SSE response is received
  return requestPromise;
}

// Initialize connection with the server
async function initialize() {
  try {
    const result = await sendRequest('initialize', {
      client: {
        name: 'example-client',
        version: '1.0.0',
      },
      initialization_options: {
        capabilities: {},
      },
    });
    
    console.log('Initialization successful:', result);
    return result;
  } catch (error) {
    console.error('Initialization failed:', error);
    throw error;
  }
}

// Query domain knowledge
async function queryDomainKnowledge(query, domains = [], limit = 5) {
  try {
    // First get available tools
    const listToolsResult = await sendRequest('list_tools', {});
    console.log('Available tools:', listToolsResult.tools.map(t => t.name).join(', '));
    
    // Call the query_domain_knowledge tool
    const callToolResult = await sendRequest('call_tool', {
      name: 'query_domain_knowledge',
      arguments: {
        query,
        domains,
        limit,
      },
    });
    
    // Parse the text content as JSON
    const content = callToolResult.content[0].text;
    return JSON.parse(content);
  } catch (error) {
    console.error('Query failed:', error);
    throw error;
  }
}

// Main execution
const eventSource = connectToServer();

// Handle process termination
process.on('SIGINT', () => {
  console.log('Closing connection...');
  if (eventSource) {
    eventSource.close();
  }
  process.exit(0);
}); 