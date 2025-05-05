/**
 * Type definitions for Qdrant integration
 */

// Document structure in Qdrant
export interface QdrantDocument {
  id: string;
  text: string;
  source: string;
  metadata?: Record<string, any>;
}

// Search result from Qdrant
export interface QdrantSearchResult {
  id: string;
  score: number;
  payload?: {
    text: string;
    source: string;
    [key: string]: any;
  };
  vector?: number[];
}

// Collection info from Qdrant
export interface QdrantCollection {
  name: string;
  [key: string]: any;
}

// Collections response from Qdrant
export interface QdrantCollectionsResponse {
  collections: QdrantCollection[];
  time: number;
}

// Sparse vector representation
export interface SparseVector {
  indices: number[];
  values: number[];
}

// Formatted result returned by the MCP server
export interface FormattedResult {
  text: string;
  metadata: {
    source: string;
    score: number;
    [key: string]: any;
  };
}

// Hybrid search options
export interface HybridSearchOptions {
  // Weight for dense vector search (0-1)
  denseWeight?: number;
  // Weight for sparse vector search (0-1)
  sparseWeight?: number;
  // Limit number of results
  limit?: number;
  // Score threshold for filtering results
  scoreThreshold?: number;
  // Specific domains to search in
  domains?: string[];
}

// Default hybrid search weights
export const DEFAULT_HYBRID_SEARCH_WEIGHTS = {
  denseWeight: 0.7,
  sparseWeight: 0.3
};

// Final response structure from the MCP server
export interface QdrantSearchResponse {
  results: FormattedResult[];
} 