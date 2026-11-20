import { QdrantClient } from '@qdrant/js-client-rest';
import { ChromaClient, Collection, IncludeEnum, IEmbeddingFunction } from 'chromadb';
import { generateEmbedding } from '../../utils/embedding';
import { QDRANT_URL, QDRANT_API_KEY } from '../../configs/qdrant';
import { CHROMA_URL } from '../../configs/chroma';
import { COLLECTION_NAME, DatabaseType, DATABASE_TYPE } from '../../configs/common';
import { FormattedResult } from '../../types/qdrant';
import { GEMINI_EMBEDDING_DIMENSIONS } from '../../configs/gemini';
import { KnowledgeSearchError, errorStatus, errorText } from '../../utils/errors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple embedding function implementation for Chroma
class CustomEmbeddingFunction implements IEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await generateEmbedding(text, 'RETRIEVAL_DOCUMENT');
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
  /** Vector size of the Qdrant collection (read at startup); undefined if unknown. */
  private collectionVectorSize?: number;
  private collectionExists?: boolean;

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
      
      this.collectionExists = collectionExists;

      if (!collectionExists) {
        console.error(`Collection ${this.collectionName} does not exist. This MCP is query-only; searches will fail until COLLECTION_NAME is fixed.`);
      } else {
        this.collectionVectorSize = await this.readQdrantVectorSize();
        console.log(`Using existing Qdrant collection ${this.collectionName}${this.collectionVectorSize ? ` (${this.collectionVectorSize}-dimensional vectors)` : ''}.`);
        if (GEMINI_EMBEDDING_DIMENSIONS && this.collectionVectorSize && GEMINI_EMBEDDING_DIMENSIONS !== this.collectionVectorSize) {
          console.error(`GEMINI_EMBEDDING_DIMENSIONS=${GEMINI_EMBEDDING_DIMENSIONS} does not match collection ${this.collectionName} (${this.collectionVectorSize}); every search will fail until it is fixed.`);
        }
      }
    } catch (error) {
      console.error(`Error checking Qdrant collections: ${errorText(error)}`);
      throw error;
    }
  }

  /** Size of the collection's (single, unnamed) vector, or undefined when it cannot be read. */
  private async readQdrantVectorSize(): Promise<number | undefined> {
    try {
      const info: any = await this.qdrantClient!.getCollection(this.collectionName);
      const vectors = info?.config?.params?.vectors;
      const size = typeof vectors?.size === 'number' ? vectors.size : undefined;
      return size;
    } catch (error) {
      console.error(`Could not read vector size of collection ${this.collectionName}: ${errorText(error)}`);
      return undefined;
    }
  }

  /**
   * Output dimensionality for query embeddings: GEMINI_EMBEDDING_DIMENSIONS when set (must match the
   * collection), otherwise the collection's own vector size, otherwise the model default.
   */
  private queryDimensions(): number | undefined {
    if (GEMINI_EMBEDDING_DIMENSIONS) {
      if (this.collectionVectorSize && GEMINI_EMBEDDING_DIMENSIONS !== this.collectionVectorSize) {
        throw new KnowledgeSearchError(
          `Configuration error: GEMINI_EMBEDDING_DIMENSIONS=${GEMINI_EMBEDDING_DIMENSIONS} but collection ${this.collectionName} stores ${this.collectionVectorSize}-dimensional vectors. Set GEMINI_EMBEDDING_DIMENSIONS=${this.collectionVectorSize} (or remove it).`,
          'config');
      }
      return GEMINI_EMBEDDING_DIMENSIONS;
    }
    return this.collectionVectorSize;
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
    if (!query || !query.trim()) {
      throw new KnowledgeSearchError('The search query is empty.', 'invalid_request');
    }
    const dimensions = this.dbType === DatabaseType.QDRANT ? this.queryDimensions() : GEMINI_EMBEDDING_DIMENSIONS;
    const queryEmbedding = await generateEmbedding(query, 'RETRIEVAL_QUERY', dimensions);
    
    // Normalize domains if provided
    const normalizedDomains = domains?.filter(Boolean)
      .map(domain => domain.trim().toLowerCase());
    
    if (this.dbType === DatabaseType.QDRANT) {
      return this.searchQdrant(queryEmbedding, limit, scoreThreshold, normalizedDomains);
    } else {
      return this.searchChroma(queryEmbedding, limit, normalizedDomains);
    }
  }

  private async searchQdrant(
    queryEmbedding: number[], 
    limit: number, 
    scoreThreshold: number,
    domains?: string[]
  ): Promise<FormattedResult[]> {
    if (!this.qdrantClient) {
      throw new KnowledgeSearchError('Qdrant client is not initialized.', 'database');
    }
    if (this.collectionExists === false) {
      throw new KnowledgeSearchError(`Collection ${this.collectionName} does not exist in Qdrant (check COLLECTION_NAME).`, 'config');
    }

    try {
      // Create filter if domains are provided
      const filter = domains?.length 
        ? { 
            must: [
              { 
                key: 'domains', 
                match: { 
                  any: domains  // Domains are already normalized in the search method
                } 
              }
            ] 
          }
        : undefined;

      const searchResults = await this.qdrantClient.query(this.collectionName, {
        query: queryEmbedding,
        limit: limit,
        score_threshold: scoreThreshold,
        with_payload: { include: ['enhancedContent'] },
        filter
      });

      return searchResults.points.map(result => ({
        text: String(result.payload?.enhancedContent || ''),
        metadata: {
          source: '',
          score: result.score
        }
      }));
    } catch (error) {
      const status = errorStatus(error);
      const detail = errorText(error);
      console.error(`Error searching Qdrant collection ${this.collectionName}${status ? ` (HTTP ${status})` : ''}: ${detail}`);
      const dimension = /vector dimension error/i.test(detail);
      throw new KnowledgeSearchError(
        dimension
          ? `Configuration error: ${detail}. The query embedding size must equal the collection's vector size (set GEMINI_EMBEDDING_DIMENSIONS accordingly).`
          : `Qdrant search in collection ${this.collectionName} failed${status ? ` (HTTP ${status})` : ''}: ${detail}`,
        dimension ? 'config' : 'database',
        status);
    }
  }

  private async searchChroma(
    queryEmbedding: number[], 
    limit: number,
    domains?: string[]
  ): Promise<FormattedResult[]> {
    if (!this.chromaCollection) {
      throw new KnowledgeSearchError(`Chroma collection ${this.collectionName} is not available.`, 'config');
    }

    const where = domains?.length 
      ? { domains: { $in: domains } }
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