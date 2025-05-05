import { QdrantClient } from '@qdrant/js-client-rest';
import { ChromaClient, Collection, IncludeEnum, IEmbeddingFunction } from 'chromadb';
import { generateEmbedding } from '../../utils/embedding';
import { generateSparseEmbedding, sparseSimilarity } from '../../utils/sparse-embedding';
import { QDRANT_URL, QDRANT_API_KEY } from '../../configs/qdrant';
import { CHROMA_URL } from '../../configs/chroma';
import { COLLECTION_NAME, DatabaseType, DATABASE_TYPE } from '../../configs/common';
import { 
  FormattedResult, 
  SparseVector, 
  HybridSearchOptions, 
  DEFAULT_HYBRID_SEARCH_WEIGHTS 
} from '../../types/qdrant';
import dotenv from 'dotenv';
import { TaskType } from '@google/generative-ai';

// Load environment variables
dotenv.config();

// Simple embedding function implementation for Chroma
class CustomEmbeddingFunction implements IEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await generateEmbedding(text, TaskType.RETRIEVAL_DOCUMENT);
      embeddings.push(embedding);
    }
    return embeddings;
  }
}

// Database service class
export class DatabaseService {
  private qdrantClient?: QdrantClient;
  private chromaClient?: ChromaClient;
  private chromaCollection?: Collection;
  private dbType: DatabaseType;
  private collectionName: string;
  private embeddingFunction: IEmbeddingFunction;

  constructor() {
    // Use the database type from common config
    this.dbType = DATABASE_TYPE;
    this.collectionName = COLLECTION_NAME;
    this.embeddingFunction = new CustomEmbeddingFunction();
    
    console.log(`Using database type: ${this.dbType}`);
  }

  getDbType(): DatabaseType {
    return this.dbType;
  }

  async initialize(): Promise<void> {
    if (this.dbType === DatabaseType.QDRANT) {
      await this.initializeQdrant();
    } else {
      await this.initializeChroma();
    }
  }

  private async initializeQdrant(): Promise<void> {
    this.qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      checkCompatibility: false,
    });

    try {
      const collections = await this.qdrantClient.getCollections();
      const collectionExists = collections.collections.some(c => c.name === this.collectionName);
      
      if (!collectionExists) {
        console.log(`Collection ${this.collectionName} does not exist. This MCP is query-only.`);
      } else {
        console.log(`Using existing Qdrant collection ${this.collectionName}.`);
      }
    } catch (error) {
      console.error('Error checking Qdrant collections:', error);
      throw error;
    }
  }

  private async initializeChroma(): Promise<void> {
    this.chromaClient = new ChromaClient({
      path: CHROMA_URL
    });

    try {
      const collections = await this.chromaClient.listCollections();
      const collectionExists = collections.some((collection: any) => collection.name === this.collectionName);
      
      if (!collectionExists) {
        console.log(`Collection ${this.collectionName} does not exist. This MCP is query-only.`);
      } else {
        console.log(`Using existing Chroma collection ${this.collectionName}.`);
        this.chromaCollection = await this.chromaClient.getCollection({
          name: this.collectionName,
          embeddingFunction: this.embeddingFunction
        });
      }
    } catch (error) {
      console.error('Error checking Chroma collections:', error);
      throw error;
    }
  }

  async search(
    query: string, 
    limit: number = 10, 
    scoreThreshold: number = 0.7,
    domains?: string[]
  ): Promise<FormattedResult[]> {
    const queryEmbedding = await generateEmbedding(query, TaskType.RETRIEVAL_QUERY);
    
    if (this.dbType === DatabaseType.QDRANT) {
      return this.searchQdrant(queryEmbedding, limit, scoreThreshold, domains);
    } else {
      return this.searchChroma(queryEmbedding, limit, domains);
    }
  }

  async hybridSearch(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<FormattedResult[]> {
    // Set default options
    const {
      denseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.denseWeight,
      sparseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.sparseWeight,
      limit = 10,
      scoreThreshold = 0.7,
      domains
    } = options;

    if (this.dbType === DatabaseType.QDRANT) {
      return this.hybridSearchQdrant(query, {
        denseWeight,
        sparseWeight,
        limit,
        scoreThreshold,
        domains
      });
    } else {
      // For Chroma we'll implement a client-side hybrid search
      return this.hybridSearchChroma(query, {
        denseWeight,
        sparseWeight,
        limit,
        scoreThreshold,
        domains
      });
    }
  }

  private async hybridSearchQdrant(
    query: string,
    options: HybridSearchOptions
  ): Promise<FormattedResult[]> {
    if (!this.qdrantClient) {
      throw new Error('Qdrant client not initialized');
    }

    const {
      denseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.denseWeight,
      sparseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.sparseWeight,
      limit = 10,
      scoreThreshold = 0.7,
      domains
    } = options;

    try {
      // Generate both dense and sparse embeddings
      const denseEmbedding = await generateEmbedding(query, TaskType.RETRIEVAL_QUERY);
      const sparseEmbedding = generateSparseEmbedding(query);

      // Prepare filter for domains if specified
      const filter = domains?.length 
        ? { must: [{ key: 'domain', match: { any: domains } }] }
        : undefined;

      // Configure hybrid search with both vector types
      const searchResults = await this.qdrantClient.search(this.collectionName, {
        vector: {
          name: "dense",  // The name of the dense vector field
          vector: denseEmbedding
        },
        with_payload: { include: ['enhancedContent'] },
        limit: limit * 2, // Fetch more results to allow for post-filtering
        filter
      });

      // If we have valid sparse embeddings, augment the search with sparse matching
      if (sparseEmbedding.indices.length > 0 && sparseWeight > 0) {
        // Get all the document IDs from the initial search
        const documentIds = searchResults.map(result => result.id);

        // For each result, adjust scores with sparse similarity
        for (const result of searchResults) {
          // Extract sparse vector from payload if available
          const payloadSparseIndices = result.payload?.sparse_indices as number[] | undefined;
          const payloadSparseValues = result.payload?.sparse_values as number[] | undefined;

          if (payloadSparseIndices && payloadSparseValues) {
            const docSparseVector = {
              indices: payloadSparseIndices,
              values: payloadSparseValues
            };

            // Calculate sparse similarity
            const sparseSim = sparseSimilarity(sparseEmbedding, docSparseVector);
            
            // Combine dense and sparse scores
            result.score = (denseWeight * result.score) + (sparseWeight * sparseSim);
          }
        }

        // Re-sort results by combined score
        searchResults.sort((a, b) => b.score - a.score);
      }

      // Filter by score threshold and limit results
      const filteredResults = searchResults
        .filter(result => result.score >= scoreThreshold)
        .slice(0, limit);

      return filteredResults.map(result => ({
        text: String(result.payload?.enhancedContent || ''),
        metadata: {
          source: String(result.payload?.source || ''),
          score: result.score,
          // Add other metadata from payload
          ...(result.payload || {})
        }
      }));
    } catch (error) {
      console.error(`Error performing hybrid search on Qdrant collection ${this.collectionName}:`, error);
      return [];
    }
  }

  private async hybridSearchChroma(
    query: string,
    options: HybridSearchOptions
  ): Promise<FormattedResult[]> {
    if (!this.chromaCollection) {
      throw new Error('Chroma collection not initialized');
    }

    const {
      denseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.denseWeight,
      sparseWeight = DEFAULT_HYBRID_SEARCH_WEIGHTS.sparseWeight,
      limit = 10,
      scoreThreshold = 0.7,
      domains
    } = options;

    try {
      // Generate dense embedding for semantic search
      const denseEmbedding = await generateEmbedding(query, TaskType.RETRIEVAL_QUERY);
      // Generate sparse embedding for keyword matching
      const sparseEmbedding = generateSparseEmbedding(query);

      // Configure where clause for domain filtering
      const where = domains?.length 
        ? { domain: { $in: domains } }
        : undefined;

      // Get more results initially to allow for reranking
      const searchResults = await this.chromaCollection.query({
        queryEmbeddings: [denseEmbedding],
        nResults: limit * 2, // Get more results for reranking
        where,
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances, IncludeEnum.Embeddings]
      });

      const hybridResults: {
        text: string;
        denseScore: number;
        sparseScore: number;
        combinedScore: number;
        metadata: Record<string, any>;
      }[] = [];

      if (searchResults.documents && searchResults.documents.length > 0 && 
          searchResults.metadatas && searchResults.distances && searchResults.embeddings) {
        const docs = searchResults.documents[0] || [];
        const metas = searchResults.metadatas[0] || [];
        const distances = searchResults.distances[0] || [];
        const embeddings = searchResults.embeddings[0] || [];

        for (let i = 0; i < docs.length; i++) {
          // Skip null or undefined documents
          if (!docs[i]) continue;

          // Calculate dense similarity (convert distance to similarity)
          const denseScore = 1 - (distances[i] || 0);
          
          // Default sparse score
          let sparseScore = 0;
          
          // If we have sparse embedding data in the metadata
          const metaObj = metas[i] && typeof metas[i] === 'object' ? metas[i] as Record<string, any> : {};
          if (metaObj.sparse_indices && metaObj.sparse_values) {
            // Calculate sparse similarity score using our utility
            const docSparseVector = {
              indices: metaObj.sparse_indices as number[],
              values: metaObj.sparse_values as number[]
            };
            sparseScore = sparseSimilarity(sparseEmbedding, docSparseVector);
          }
          
          // Combine scores with respective weights
          const combinedScore = (denseWeight * denseScore) + (sparseWeight * sparseScore);
          
          if (combinedScore >= scoreThreshold) {
            hybridResults.push({
              text: String(docs[i]),
              denseScore,
              sparseScore,
              combinedScore,
              metadata: {
                ...metaObj,
                score: combinedScore
              }
            });
          }
        }
      }

      // Sort by combined score and limit results
      hybridResults.sort((a, b) => b.combinedScore - a.combinedScore);
      const limitedResults = hybridResults.slice(0, limit);

      // Format results
      return limitedResults.map(result => ({
        text: result.text,
        metadata: {
          source: String(result.metadata.source || ''),
          score: result.combinedScore,
          ...result.metadata
        }
      }));
    } catch (error) {
      console.error(`Error performing hybrid search on Chroma collection ${this.collectionName}:`, error);
      return [];
    }
  }

  private async searchQdrant(
    queryEmbedding: number[], 
    limit: number, 
    scoreThreshold: number,
    domains?: string[]
  ): Promise<FormattedResult[]> {
    if (!this.qdrantClient) {
      throw new Error('Qdrant client not initialized');
    }

    try {
      const filter = domains?.length 
        ? { must: [{ key: 'domain', match: { any: domains } }] }
        : undefined;

      const searchResults = await this.qdrantClient.search(this.collectionName, {
        vector: queryEmbedding,
        limit: limit,
        score_threshold: scoreThreshold,
        with_payload: { include: ['enhancedContent'] },
        filter
      });
      
      return searchResults.map(result => ({
        text: String(result.payload?.enhancedContent || ''),
        metadata: {
          source: '',
          score: result.score
        }
      }));
    } catch (error) {
      console.error(`Error searching Qdrant collection ${this.collectionName}:`, error);
      return [];
    }
  }

  private async searchChroma(
    queryEmbedding: number[], 
    limit: number,
    domains?: string[]
  ): Promise<FormattedResult[]> {
    if (!this.chromaCollection) {
      throw new Error('Chroma collection not initialized');
    }

    const where = domains?.length 
      ? { domain: { $in: domains } }
      : undefined;

    const searchResults = await this.chromaCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where,
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances]
    });
    
    const formattedResults: FormattedResult[] = [];
    
    if (searchResults.documents && searchResults.documents.length > 0 && 
        searchResults.metadatas && searchResults.distances) {
      const docs = searchResults.documents[0] || [];
      const metas = searchResults.metadatas[0] || [];
      const distances = searchResults.distances[0] || [];
      
      for (let i = 0; i < docs.length; i++) {
        const similarityScore = 1 - (distances[i] || 0);
        const docText = docs[i] !== null && docs[i] !== undefined ? String(docs[i]) : '';
        const metaObj = metas[i] && typeof metas[i] === 'object' ? metas[i] as Record<string, any> : {};
        
        formattedResults.push({
          text: docText,
          metadata: {
            source: String(metaObj.source || ''),
            score: similarityScore,
            ...metaObj
          }
        });
      }
    }
    
    return formattedResults;
  }
} 