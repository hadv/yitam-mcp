# YITAM MCP Server

Your Intelligent Task Assistant Manager - Model Context Protocol Server

## Description

YITAM MCP Server provides a vector database-backed retrieval system using the Model Context Protocol. It supports both Qdrant and Chroma vector databases for efficient semantic search capabilities.

## Features

- Semantic search using vector embeddings
- Support for multiple vector databases (Qdrant, Chroma)
- MCP-compliant server implementation
- TypeScript/Node.js implementation
- Built-in FastEmbed support
- Multiple transport options (stdio and SSE)

## Prerequisites

- Node.js (LTS version)
- npm
- Either Qdrant or Chroma vector database

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd yitam-mcp
```

2. Install dependencies and build:
```bash
# For clean/production install:
npm run install:clean

# For development install:
npm run install:dev
```

3. Copy the example environment file and configure it:
```bash
cp .env.example .env
```

## Configuration

Edit the `.env` file with your settings:

- `COLLECTION_NAME`: Your vector database collection name
- `DATABASE_TYPE`: Choose between 'qdrant' or 'chroma'
- `QDRANT_URL`: Your Qdrant server URL (if using Qdrant)
- `QDRANT_API_KEY`: Your Qdrant API key (if using Qdrant)
- `CHROMA_URL`: Your Chroma server URL (if using Chroma)
- `TRANSPORT_MODE`: Choose between 'stdio' (default) or 'sse'
- `PORT`: Port number for SSE server (default: 3000)

## Usage

### Development

```bash
# With stdio transport (default)
npm run dev

# With SSE transport
npm run dev:sse
```

### Production

```bash
# With stdio transport (default)
npm start

# With SSE transport
npm run start:sse
```

### Docker

The Docker image supports both transport methods. By default, it uses SSE:

```bash
# Build the Docker image
docker build -t yitam-mcp .

# Run with default transport (SSE)
docker run -p 3000:3000 yitam-mcp

# Run with stdio transport
docker run -e TRANSPORT_MODE=stdio yitam-mcp
```

## Client Integration

### Using MCP Dependencies

For clients using MCP dependencies, you can connect using either stdio or SSE transport, depending on your needs.

### Without MCP Dependencies (HTTP/SSE)

One of the major advantages of the SSE transport is that client applications can connect to the MCP server without requiring MCP dependencies. See the `examples/http-client.js` for a complete example of connecting via HTTP/SSE.

Basic integration flow:

1. Establish an SSE connection to receive server responses
2. Send JSON-RPC requests via HTTP POST to the messages endpoint
3. Process responses from the SSE connection

This enables any HTTP-capable application to use the MCP server without direct coupling to MCP libraries.

## License

MIT 