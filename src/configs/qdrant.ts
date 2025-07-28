/**
 * Qdrant Configuration
 * 
 * This file contains configuration constants for Qdrant and embedding generation.
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Vector dimension for Gemini embedding model
// gemini-embedding-001 produces 3072-dimensional embeddings by default
export const VECTOR_SIZE = 3072;

// Qdrant configuration
export const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY; 