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

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## License

MIT 