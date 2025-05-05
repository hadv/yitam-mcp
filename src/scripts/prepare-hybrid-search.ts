/**
 * Prepare Hybrid Search Script
 * 
 * This script prepares an existing Qdrant collection for hybrid search by:
 * 1. Reading all documents in the collection
 * 2. Generating sparse embeddings for each document
 * 3. Updating the documents with sparse embedding vectors
 * 
 * Run with: npm run build && node dist/scripts/prepare-hybrid-search.js
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { generateSparseEmbedding } from '../utils/sparse-embedding';
import { QDRANT_URL, QDRANT_API_KEY } from '../configs/qdrant';
import { COLLECTION_NAME } from '../configs/common';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Number of records to process in each batch
const BATCH_SIZE = 100;
// Whether to perform a dry run (no updates)
const DRY_RUN = process.env.DRY_RUN === 'true';

async function prepareHybridSearch() {
  console.log('Preparing collection for hybrid search...');
  console.log(`Collection: ${COLLECTION_NAME}`);
  console.log(`Qdrant URL: ${QDRANT_URL}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Dry run: ${DRY_RUN}`);

  // Initialize Qdrant client
  const qdrantClient = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
    checkCompatibility: false,
  });

  try {
    // Check if collection exists
    const collections = await qdrantClient.getCollections();
    const collectionExists = collections.collections.some(c => c.name === COLLECTION_NAME);
    
    if (!collectionExists) {
      console.error(`Collection ${COLLECTION_NAME} does not exist.`);
      process.exit(1);
    }

    // Get collection info to verify named vectors
    const collectionInfo = await qdrantClient.getCollection(COLLECTION_NAME);
    console.log(`Collection info:`, JSON.stringify(collectionInfo, null, 2));

    // Ensure named vectors are enabled
    const hasNamedVectors = collectionInfo.config?.params?.vectors && 
                            typeof collectionInfo.config.params.vectors === 'object' &&
                            !Array.isArray(collectionInfo.config.params.vectors);
    
    if (!hasNamedVectors) {
      console.error(`Collection ${COLLECTION_NAME} does not have named vectors. Please recreate it with named vectors support.`);
      process.exit(1);
    }

    // Check for existing "sparse" vector
    const hasExistingSparseVector = 
      collectionInfo.config?.params?.vectors && 
      (collectionInfo.config.params.vectors as any).sparse !== undefined;
    
    console.log(`Collection has sparse vector field: ${hasExistingSparseVector}`);

    // Add sparse vector if it doesn't exist
    if (!hasExistingSparseVector && !DRY_RUN) {
      console.log('Creating sparse vector field...');
      // Using type assertion to bypass typing limitations
      await (qdrantClient as any).updateCollection(COLLECTION_NAME, {
        vectors: {
          sparse: {
            size: 10000, // Large size for sparse vectors
            distance: 'Dot'
          }
        }
      });
      console.log('Sparse vector field created.');
    }

    // Process documents in batches
    let offset = 0;
    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`Processing batch starting at offset ${offset}...`);
      
      // Get batch of documents
      const scrollResult = await qdrantClient.scroll(COLLECTION_NAME, {
        limit: BATCH_SIZE,
        offset: { "id": offset } 
      });
      
      const points = scrollResult.points;
      
      if (points.length === 0) {
        console.log('No more documents to process.');
        hasMore = false;
        break;
      }

      console.log(`Processing ${points.length} documents...`);
      
      // Process each document
      const updateOperations = [];
      
      for (const point of points) {
        const pointId = point.id;
        
        // Get document text - check multiple potential fields
        const text = String(
          point.payload?.enhancedContent || 
          point.payload?.content || 
          point.payload?.text || 
          ''
        );
        
        if (!text) {
          console.warn(`Document ${pointId} has no text content to generate sparse embedding.`);
          continue;
        }
        
        // Generate sparse embedding
        const sparseVector = generateSparseEmbedding(text);
        
        // Skip if no meaningful sparse embedding was generated
        if (sparseVector.indices.length === 0) {
          console.warn(`Document ${pointId} generated empty sparse embedding.`);
          continue;
        }
        
        // Create update operation
        updateOperations.push({
          id: pointId,
          payload: {
            sparse_indices: sparseVector.indices,
            sparse_values: sparseVector.values
          },
          // Using separate sparse vector format for Qdrant
          vectors: {
            sparse: {
              indices: sparseVector.indices,
              values: sparseVector.values
            }
          }
        } as any); // Type assertion to bypass client limitations
      }
      
      // Update documents if not in dry run mode
      if (updateOperations.length > 0 && !DRY_RUN) {
        console.log(`Updating ${updateOperations.length} documents with sparse embeddings...`);
        // Using type assertion to bypass client limitations
        await (qdrantClient as any).updateVectors(COLLECTION_NAME, {
          points: updateOperations
        });
        console.log('Update completed.');
      } else if (DRY_RUN) {
        console.log(`[DRY RUN] Would update ${updateOperations.length} documents.`);
      }
      
      totalProcessed += points.length;
      console.log(`Processed ${totalProcessed} documents so far.`);
      
      // Get the next offset
      if (points.length < BATCH_SIZE) {
        hasMore = false;
      } else {
        // Use the id of the last point as the next offset
        offset = typeof points[points.length - 1].id === 'number' 
          ? (points[points.length - 1].id as number) + 1
          : points.length + offset;
      }
    }
    
    console.log(`Completed processing ${totalProcessed} documents.`);
    console.log('Hybrid search preparation complete!');
    
  } catch (error) {
    console.error('Error preparing collection for hybrid search:', error);
    process.exit(1);
  }
}

// Run the script
prepareHybridSearch().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 