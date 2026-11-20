/**
 * Embedding utilities for Gemini embedding service
 *
 * This file contains utility functions for generating embeddings using Google's Gemini API.
 * Updated to work with the @google/genai SDK and gemini-embedding-001 model.
 */

import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EMBEDDING_DIMENSIONS } from '../configs/gemini';
import { KnowledgeSearchError, errorStatus, errorText } from './errors';

let client: GoogleGenAI | undefined;

/** Maps a Gemini SDK error to a KnowledgeSearchError with an actionable message. */
function classifyGeminiError(error: unknown): KnowledgeSearchError {
  const status = errorStatus(error);
  const text = errorText(error);
  const lower = text.toLowerCase();
  // Note: Gemini's ordinary per-minute 429 also says "check your plan and billing details", so a bare
  // "billing" must not count as a billing failure.
  if (status === 402 || /credits? (are|is) depleted|prepayment|payment required|insufficient (balance|funds)/.test(lower)) {
    return new KnowledgeSearchError(
      `Gemini embedding refused (HTTP ${status ?? 402}): the Gemini project behind GEMINI_API_KEY has no credits / billing is not active. Knowledge search is unavailable until it is topped up or the key is replaced.`,
      'embedding_billing', status);
  }
  if (status === 401 || status === 403 || /api key not valid|permission denied|unauthenticated/.test(lower)) {
    return new KnowledgeSearchError(
      `Gemini embedding refused (HTTP ${status ?? 403}): GEMINI_API_KEY is invalid or not allowed to call ${GEMINI_MODEL}.`,
      'embedding_auth', status);
  }
  if (status === 429 || /resource_exhausted|rate limit|quota/.test(lower)) {
    return new KnowledgeSearchError(
      `Gemini embedding rate-limited (HTTP ${status ?? 429}); try again shortly. Detail: ${text}`,
      'embedding_rate_limit', status);
  }
  return new KnowledgeSearchError(`Gemini embedding failed${status ? ` (HTTP ${status})` : ''}: ${text}`, 'embedding', status);
}

/**
 * Generate an embedding vector for the provided text using Gemini API.
 *
 * @param text The text to generate an embedding for
 * @param taskType The task type (optional, for compatibility; currently not sent)
 * @param dimensions Output dimensionality; defaults to GEMINI_EMBEDDING_DIMENSIONS (model default 3072 when unset)
 * @returns A vector representation of the text (numeric embedding)
 * @throws KnowledgeSearchError with a readable reason on any failure
 */
export async function generateEmbedding(
  text: string,
  taskType?: string,
  dimensions: number | undefined = GEMINI_EMBEDDING_DIMENSIONS
): Promise<number[]> {
  if (!GEMINI_API_KEY) {
    throw new KnowledgeSearchError('GEMINI_API_KEY is not set, so queries cannot be embedded for knowledge search.', 'config');
  }

  let response;
  try {
    client ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    response = await client.models.embedContent({
      model: GEMINI_MODEL,
      contents: [text],
      config: dimensions ? { outputDimensionality: dimensions } : undefined
    });
  } catch (error) {
    const classified = classifyGeminiError(error);
    console.error(`Error generating embedding with Gemini API: ${classified.message}`);
    throw classified;
  }

  const values = response?.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new KnowledgeSearchError('Gemini returned no embedding values for the query.', 'embedding');
  }
  if (dimensions && values.length !== dimensions) {
    throw new KnowledgeSearchError(
      `Gemini returned a ${values.length}-dimensional embedding but ${dimensions} was requested.`, 'embedding');
  }
  return values;
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