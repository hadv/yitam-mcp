# MCP Client Examples

This directory contains examples of how to connect to the YITAM MCP server without requiring MCP dependencies.

## HTTP Client Example

The `http-client.js` script demonstrates how to connect to the YITAM MCP server using Server-Sent Events (SSE) transport. This client implementation:

1. Connects to the MCP server using SSE
2. Initializes the connection
3. Queries domain knowledge using the MCP server's tools
4. Processes and displays the results

### Installation

Install the required dependencies:

```bash
npm install eventsource node-fetch uuid
```

### Usage

Make sure the MCP server is running in SSE mode, then run:

```bash
# With default server URL (http://localhost:3000)
node http-client.js

# Or with a custom server URL
MCP_SERVER_URL=http://your-server:3000 node http-client.js
```

### How it Works

The client communicates with the MCP server using the standard JSON-RPC 2.0 protocol over HTTP:

1. **SSE Connection**: The client establishes an SSE connection to receive server responses
2. **JSON-RPC Requests**: Requests are sent via HTTP POST to the `/messages` endpoint
3. **Message Handling**: Responses are received via the SSE connection and matched to requests using request IDs

This implementation demonstrates how any HTTP-capable client can interact with the MCP server without including MCP-specific dependencies.

## Customizing

To adapt this example for your own applications:

1. Modify the query parameters in the `queryDomainKnowledge` function
2. Change the flow in the `connectToServer` function to match your application's needs
3. Add error handling suitable for your production environment

## Other Transport Examples

Additional examples for other transport methods may be added in the future. 