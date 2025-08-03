/**
 * Gemini Embedding Configuration
 * 
 * This file contains configuration constants for Gemini embedding service.
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Gemini configuration
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-embedding-001';

// Embedding dimensions configuration
// gemini-embedding-001 supports up to 3072 dimensions (default)
// You can reduce dimensions using outputDimensionality for compatibility with existing collections
export const GEMINI_EMBEDDING_DIMENSIONS = process.env.GEMINI_EMBEDDING_DIMENSIONS
  ? parseInt(process.env.GEMINI_EMBEDDING_DIMENSIONS, 10)
  : undefined; // undefined = use model default (3072)