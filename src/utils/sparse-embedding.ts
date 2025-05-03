/**
 * Sparse Embedding Utilities
 * 
 * This file contains utility functions for generating sparse embeddings
 * used in hybrid search. The sparse embeddings represent keyword-based
 * matching in contrast to dense semantic embeddings.
 */

/**
 * Simple BM25-inspired token weighting algorithm for sparse embeddings
 * 
 * @param text The text to convert to sparse embedding
 * @returns A sparse vector representation with indices and values
 */
export function generateSparseEmbedding(text: string): { indices: number[], values: number[] } {
  if (!text || typeof text !== 'string') {
    return { indices: [], values: [] };
  }
  
  // Normalize text: convert to lowercase, remove special characters
  const normalizedText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
    .trim();
  
  // Tokenize text (simple whitespace tokenization)
  const tokens = normalizedText.split(' ');
  
  // Remove duplicates while preserving order
  const uniqueTokens = Array.from(new Set(tokens));
  
  // Create a mapping of token to index (dictionary)
  const dictionary: Record<string, number> = {};
  const tokenFrequency: Record<string, number> = {};
  
  // Count token frequencies
  tokens.forEach(token => {
    if (token.length < 2) return; // Skip very short tokens
    tokenFrequency[token] = (tokenFrequency[token] || 0) + 1;
  });
  
  // Create dictionary from unique tokens
  uniqueTokens.forEach((token, index) => {
    if (token.length < 2) return; // Skip very short tokens
    dictionary[token] = index;
  });
  
  // Calculate BM25-inspired weights for each token
  const indices: number[] = [];
  const values: number[] = [];
  
  const k1 = 1.2; // BM25 parameter
  const b = 0.75; // BM25 parameter
  const avgDocLength = 20; // Average document length (approximation)
  const docLength = tokens.length;
  
  // Compute sparse embedding
  Object.entries(tokenFrequency).forEach(([token, freq]) => {
    const index = dictionary[token];
    if (index !== undefined) {
      // BM25-inspired term weighting formula (simplified)
      const tf = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * docLength / avgDocLength));
      const weight = tf; // In full BM25, we'd multiply by IDF, but we don't have corpus stats here
      
      indices.push(index);
      values.push(weight);
    }
  });
  
  return { indices, values };
}

/**
 * Calculate sparse vector similarity using dot product
 * 
 * @param a First sparse vector {indices, values}
 * @param b Second sparse vector {indices, values}
 * @returns Similarity score
 */
export function sparseSimilarity(
  a: { indices: number[], values: number[] },
  b: { indices: number[], values: number[] }
): number {
  // Convert a to a map for faster lookups
  const aMap = new Map<number, number>();
  for (let i = 0; i < a.indices.length; i++) {
    aMap.set(a.indices[i], a.values[i]);
  }
  
  // Compute dot product where indices overlap
  let dotProduct = 0;
  for (let i = 0; i < b.indices.length; i++) {
    const index = b.indices[i];
    const aValue = aMap.get(index);
    if (aValue !== undefined) {
      dotProduct += aValue * b.values[i];
    }
  }
  
  return dotProduct;
} 