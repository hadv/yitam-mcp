/**
 * Embedding utilities for Gemini embedding service
 *
 * This file contains utility functions for generating embeddings using Google's Gemini API.
 * Updated to work with the @google/genai SDK and gemini-embedding-001 model.
 */

import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EMBEDDING_DIMENSIONS } from '../configs/gemini';

/**
 * Generate an embedding vector for the provided text using Gemini API
 *
 * Uses the new @google/genai SDK with the updated API format.
 *
 * @param text The text to generate an embedding for
 * @param taskType The task type (optional, for compatibility)
 * @returns A vector representation of the text (numeric embedding)
 */
export async function generateEmbedding(
  text: string,
  taskType?: string
): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for Gemini embeddings');
  }

  try {
    // Initialize Gemini API with the new SDK
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    });

    // Use the new embedContent API format with optional dimension configuration
    const response = await ai.models.embedContent({
      model: GEMINI_MODEL,
      contents: [text],
      config: GEMINI_EMBEDDING_DIMENSIONS ? {
        outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS
      } : undefined
    });

    // Return the values from the first embedding
    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error('No embeddings returned from API');
    }

    const embedding = response.embeddings[0];
    if (!embedding.values) {
      throw new Error('No values in embedding response');
    }

    return embedding.values;
  } catch (error) {
    console.error('Error generating embedding with Gemini API:', error);
    throw error;
  }
}

/**
 * Helper function to calculate cosine similarity between two vectors
 * 
 * @param a First vector
 * @param b Second vector
 * @returns Cosine similarity score (0-1)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must be of the same length');
  }
  
  let dotProduct = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    aMagnitude += a[i] * a[i];
    bMagnitude += b[i] * b[i];
  }
  
  aMagnitude = Math.sqrt(aMagnitude);
  bMagnitude = Math.sqrt(bMagnitude);
  
  if (aMagnitude === 0 || bMagnitude === 0) {
    return 0;
  }
  
  return dotProduct / (aMagnitude * bMagnitude);
} 