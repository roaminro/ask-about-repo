/**
 * Test script for embedding docs using fastembed and LibSQL vector store
 * 
 * This script:
 * 1. Finds all markdown files in the .repos/mastra/docs folder
 * 2. Chunks them using Mastra's RAG utilities
 * 3. Generates embeddings using fastembed (local, no API key needed)
 * 4. Stores embeddings in LibSQL vector store
 * 5. Tests querying the vector store
 * 
 * Run with: pnpm tsx scripts/test-embedding.ts
 */

import * as fs from "fs";
import * as path from "path";
import { MDocument } from "@mastra/rag";
import { embed, embedMany } from "ai";
import { fastembed } from "@mastra/fastembed";
import { LibSQLVector } from "@mastra/libsql";

const REPO_PATH = path.join(process.cwd(), ".repos/mastra");
const DOCS_PATH = path.join(REPO_PATH, "docs");
const INDEX_NAME = "docs_embeddings";

// LibSQL database file path
const DB_PATH = path.join(process.cwd(), ".data/vectors.db");

/**
 * Recursively find all markdown files in a directory
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...findMarkdownFiles(fullPath));
      }
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Read and chunk a markdown file
 */
async function processFile(filePath: string): Promise<{ text: string; metadata: Record<string, any> }[]> {
  const content = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(REPO_PATH, filePath);
  
  // Create document from markdown
  const doc = MDocument.fromMarkdown(content);
  
  // Chunk with markdown-aware strategy
  const chunks = await doc.chunk({
    strategy: "markdown",
    maxSize: 1000,
    overlap: 100,
  });
  
  // Add file path to metadata
  return chunks.map(chunk => ({
    text: chunk.text,
    metadata: {
      ...chunk.metadata,
      source: relativePath,
    },
  }));
}

async function main() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log("🔍 Finding markdown files in", DOCS_PATH);
  
  const files = findMarkdownFiles(DOCS_PATH);
  console.log(`📄 Found ${files.length} markdown files\n`);
  
  if (files.length === 0) {
    console.log("No markdown files found. Make sure the repo is cloned.");
    return;
  }
  
  // Process all files
  const testFiles = files;
  console.log(`📝 Processing all ${testFiles.length} files...\n`);
  
  // Process all files
  const allChunks: { text: string; metadata: Record<string, any> }[] = [];
  
  for (const file of testFiles) {
    const relativePath = path.relative(REPO_PATH, file);
    console.log(`  Processing: ${relativePath}`);
    
    try {
      const chunks = await processFile(file);
      allChunks.push(...chunks);
      console.log(`    → ${chunks.length} chunks`);
    } catch (error) {
      console.log(`    ⚠️ Error: ${error}`);
    }
  }
  
  console.log(`\n📊 Total chunks: ${allChunks.length}\n`);
  
  if (allChunks.length === 0) {
    console.log("No chunks to embed.");
    return;
  }
  
  // Use fastembed.small model (BAAI/bge-small-en-v1.5)
  console.log("🤖 Using fastembed.small model (BAAI/bge-small-en-v1.5)...\n");
  
  const embeddingModel = fastembed.small;
  
  // Generate embeddings
  console.log("⚡ Generating embeddings...");
  const startTime = Date.now();
  
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: allChunks.map(chunk => chunk.text),
  });
  
  const embeddingDuration = Date.now() - startTime;
  
  console.log(`   Generated ${embeddings.length} embeddings in ${(embeddingDuration / 1000).toFixed(2)}s\n`);
  
  // Initialize LibSQL vector store
  console.log("💾 Initializing LibSQL vector store...");
  console.log(`   Database: ${DB_PATH}\n`);
  
  const vectorStore = new LibSQLVector({
    id: "docs-vector-store",
    connectionUrl: `file:${DB_PATH}`,
  });
  
  // Create index (384 dimensions for bge-small-en-v1.5)
  console.log(`📦 Creating index "${INDEX_NAME}" (384 dimensions)...`);
  
  await vectorStore.createIndex({
    indexName: INDEX_NAME,
    dimension: 384,
  });
  
  console.log("   Index created (or already exists)\n");
  
  // Prepare data for upsert (separate arrays for vectors, metadata, ids)
  const ids = allChunks.map((_, i) => `chunk-${i}`);
  const metadata = allChunks.map(chunk => ({
    ...chunk.metadata,
    text: chunk.text, // Store text in metadata for retrieval
  }));
  
  // Upsert vectors
  console.log("📥 Upserting vectors into the index...");
  const upsertStart = Date.now();
  
  await vectorStore.upsert({
    indexName: INDEX_NAME,
    vectors: embeddings as number[][],
    metadata,
    ids,
  });
  
  const upsertDuration = Date.now() - upsertStart;
  console.log(`   Upserted ${embeddings.length} vectors in ${(upsertDuration / 1000).toFixed(2)}s\n`);
  
  // Test querying
  console.log("🔎 Testing vector search...\n");
  
  const testQueries = [
    "How do I create an agent in Mastra?",
    "What is RAG and how does it work?",
    "How to use tools with agents?",
  ];
  
  for (const query of testQueries) {
    console.log(`   Query: "${query}"`);
    
    // Embed the query
    const { embedding: queryEmbedding } = await embed({
      model: embeddingModel,
      value: query,
    });
    
    // Search the vector store
    const results = await vectorStore.query({
      indexName: INDEX_NAME,
      queryVector: queryEmbedding,
      topK: 3,
    });
    
    console.log(`   Top ${results.length} results:`);
    for (const result of results) {
      const source = result.metadata?.source || "unknown";
      const score = result.score?.toFixed(4) || "N/A";
      console.log(`     - [${score}] ${source}`);
    }
    console.log();
  }
  
  // Print final stats
  console.log("✅ Complete!\n");
  console.log("📈 Stats:");
  console.log(`   - Files processed: ${testFiles.length}`);
  console.log(`   - Total chunks: ${allChunks.length}`);
  console.log(`   - Embedding dimension: ${embeddings[0]?.length || 0}`);
  console.log(`   - Embedding time: ${(embeddingDuration / 1000).toFixed(2)}s`);
  console.log(`   - Upsert time: ${(upsertDuration / 1000).toFixed(2)}s`);
  console.log(`   - Database: ${DB_PATH}`);
}

main().catch(console.error);
