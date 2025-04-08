/**
 * Embedding utilities for Gemini embedding service
 * 
 * This file contains utility functions for generating embeddings using Google's Gemini API.
 * Properly configured to work with the @google/generative-ai SDK for vector embeddings.
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { GEMINI_API_KEY, GEMINI_MODEL } from '../configs/gemini';

/**
 * Generate an embedding vector for the provided text using Gemini API
 * 
 * Uses the correct format for passing taskType to the embedContent method
 * with proper type safety using Google's TaskType enum.
 * 
 * @param text The text to generate an embedding for
 * @param taskType The task type from Google's TaskType enum (RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY)
 * @returns A vector representation of the text (numeric embedding)
 */
export async function generateEmbedding(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for Gemini embeddings');
  }

  try {
    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    // Create properly formatted request object with TaskType enum
    // Note: Content object must include the 'role' property for the request to be valid
    const result = await embeddingModel.embedContent({
      content: {
        parts: [{ text }],
        role: "user"
      },
      taskType: taskType
    });
    
    return result.embedding.values;
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