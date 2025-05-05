# YITAM MCP Server

Your Intelligent Task Assistant Manager - Model Context Protocol Server

## Description

YITAM MCP Server provides a vector database-backed retrieval system using the Model Context Protocol. It supports both Qdrant and Chroma vector databases for efficient semantic search capabilities.

## Features

- Semantic search using vector embeddings
- Hybrid search combining semantic similarity and keyword matching
- Support for multiple vector databases (Qdrant, Chroma)
- MCP-compliant server implementation
- TypeScript/Node.js implementation
- Google Gemini embedding model integration
- Built-in FastEmbed support (alternative to Gemini)
- Multiple transport options (stdio and SSE)

## Prerequisites

- Node.js (LTS version)
- npm
- Either Qdrant or Chroma vector database
- Google Gemini API key (for embedding generation)

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd yitam-mcp
```

2. Install dependencies and build:
```bash
# First ensure you're using the right Node version
nvm use --lts

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
- `GEMINI_API_KEY`: Your Google Gemini API key for embeddings
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

## Hybrid Search

The server implements hybrid search functionality that combines two search approaches:

1. **Dense Vector Search**: Uses Google Gemini embedding model to understand semantic meaning.
2. **Sparse Vector Search**: Uses keyword matching for exact terminology.

### Benefits of Hybrid Search

- More accurate and relevant search results
- Combines semantic understanding with keyword precision
- Configurable weights to prioritize meaning vs. exact terms
- Better handling of domain-specific terminology

### Preparing Your Data for Hybrid Search

Before using hybrid search, you need to prepare your existing vector collection by adding sparse vectors:

```bash
# Set DRY_RUN=true to test without making changes
DRY_RUN=true npm run prepare:hybrid

# When ready, run for real
npm run prepare:hybrid
```

This script will:
1. Check your collection configuration
2. Add a sparse vector field if needed
3. Generate sparse embeddings for all documents
4. Update documents with sparse vector data

### Using Hybrid Search

The hybrid search endpoint allows you to:

- Search with both semantic and keyword matching
- Adjust weights between dense and sparse search
- Filter by domains
- Set minimum score thresholds

Example:

```json
{
  "query": "your search query",
  "domains": ["optional", "domain", "filters"],
  "limit": 10,
  "scoreThreshold": 0.7,
  "denseWeight": 0.7,
  "sparseWeight": 0.3
}
```

## License

MIT 