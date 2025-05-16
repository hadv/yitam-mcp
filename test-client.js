#!/usr/bin/env node

// Import dependencies - node-fetch needs to be used properly for CommonJS
const nodeFetch = require('node-fetch');
const fetch = (...args) => nodeFetch.default(...args);

// Client information
const clientInfo = {
  name: 'test-client',
  version: '1.0.0'
};

// Simple JSON-RPC client
const callMcp = async (method, params = {}) => {
  try {
    const response = await fetch('http://127.0.0.1:8080/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error(`Error in MCP call to ${method}:`, error);
    throw error;
  }
};

async function runClientTest() {
  try {
    console.log('Testing MCP server...');
    
    // Initialize the session
    console.log('Initializing session...');
    const initResponse = await callMcp('initialize', { 
      clientInfo: { name: 'test-client', version: '1.0.0' } 
    });
    
    console.log('Initialization response:', JSON.stringify(initResponse, null, 2));
    
    // Store the session ID for subsequent requests
    const sessionId = initResponse.result?.serverInfo?.sessionId;
    if (sessionId) {
      console.log(`Session ID: ${sessionId}`);
    }
    
    // List available tools
    console.log('Listing tools...');
    const toolsResponse = await callMcp('listTools', {});
    
    console.log('Available tools:', JSON.stringify(toolsResponse, null, 2));
    
    // If there are tools, try calling one
    if (toolsResponse?.result?.tools && toolsResponse.result.tools.length > 0) {
      const tool = toolsResponse.result.tools[0];
      console.log(`Calling tool: ${tool.name}`);
      
      const callResponse = await callMcp('callTool', {
        name: tool.name,
        arguments: {
          query: 'What is traditional Vietnamese medicine?',
          domains: ['đông y', 'y học cổ truyền'],
          limit: 5,
          scoreThreshold: 0.7
        }
      });
      
      console.log('Tool response:', JSON.stringify(callResponse, null, 2));
    } else {
      console.log('No tools available to call');
      
      // The problem might be that the tools object is empty
      console.log('Checking server capabilities...');
      // Let's fix the issue with empty tools by inspecting the server response
      console.log('Server capabilities:', (initResponse?.result?.capabilities) ? 
        JSON.stringify(initResponse.result.capabilities, null, 2) : 'No capabilities found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the test
runClientTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 