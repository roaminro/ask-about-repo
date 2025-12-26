import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

/**
 * Get the docs path for a repo
 */
function getDocsPath(repoPath: string): string | null {
  const possiblePaths = [
    path.join(repoPath, "docs"),
    path.join(repoPath, "documentation"),
    path.join(repoPath, "doc"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Recursively find all markdown files in a directory
 */
function findMarkdownFiles(dir: string, basePath: string): { path: string; relativePath: string }[] {
  const files: { path: string; relativePath: string }[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...findMarkdownFiles(fullPath, basePath));
      }
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      files.push({
        path: fullPath,
        relativePath: path.relative(basePath, fullPath),
      });
    }
  }

  return files;
}

/**
 * Build a tree structure from file paths
 */
function buildTree(files: { relativePath: string }[]): string {
  const tree: Record<string, any> = {};

  for (const file of files) {
    const parts = file.relativePath.split(path.sep);
    let current = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // It's a file
        if (!current._files) current._files = [];
        current._files.push(part);
      } else {
        // It's a directory
        if (!current[part]) current[part] = {};
        current = current[part];
      }
    }
  }

  function renderTree(node: Record<string, any>, indent = ""): string {
    let output = "";
    const dirs = Object.keys(node).filter((k) => k !== "_files").sort();
    const files = (node._files || []).sort();

    for (const dir of dirs) {
      output += `${indent}${dir}/\n`;
      output += renderTree(node[dir], indent + "  ");
    }

    for (const file of files) {
      output += `${indent}${file}\n`;
    }

    return output;
  }

  return renderTree(tree);
}

/**
 * List docs tool - Lists all documentation files in a repo
 */
export const listDocsTool = createTool({
  id: "list-docs",
  description: `Lists all documentation files (markdown) in the repository's docs folder.
Returns a tree structure of available documentation files.
Use this to discover what documentation is available before reading specific files.`,
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the cloned repository"),
  }),
  outputSchema: z.object({
    docsPath: z.string().nullable().describe("Path to the docs folder, or null if not found"),
    tree: z.string().describe("Tree structure of documentation files"),
    fileCount: z.number().describe("Total number of documentation files"),
    files: z.array(z.string()).describe("List of all doc file paths (relative to docs folder)"),
  }),
  execute: async ({ repoPath }) => {
    const docsPath = getDocsPath(repoPath);

    if (!docsPath) {
      return {
        docsPath: null,
        tree: "No docs folder found in repository",
        fileCount: 0,
        files: [],
      };
    }

    const files = findMarkdownFiles(docsPath, docsPath);
    const tree = buildTree(files);

    return {
      docsPath,
      tree: `${docsPath}/\n${tree}`,
      fileCount: files.length,
      files: files.map((f) => f.relativePath),
    };
  },
});

/**
 * Read doc tool - Reads a specific documentation file
 */
export const readDocTool = createTool({
  id: "read-doc",
  description: `Reads a specific documentation file from the repository.
Provide the relative path to the doc file (from the docs folder).
Returns the full content of the documentation file.`,
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the cloned repository"),
    docPath: z.string().describe("Relative path to the doc file (e.g., 'getting-started/installation.mdx')"),
  }),
  outputSchema: z.object({
    content: z.string().describe("Content of the documentation file"),
    fullPath: z.string().describe("Full path to the file"),
    exists: z.boolean().describe("Whether the file exists"),
  }),
  execute: async ({ repoPath, docPath }) => {
    const docsPath = getDocsPath(repoPath);

    if (!docsPath) {
      return {
        content: "Error: No docs folder found in repository",
        fullPath: "",
        exists: false,
      };
    }

    const fullPath = path.join(docsPath, docPath);

    if (!fs.existsSync(fullPath)) {
      // Try to find similar files
      const files = findMarkdownFiles(docsPath, docsPath);
      const searchTerm = docPath.toLowerCase();
      const suggestions = files
        .filter((f) => f.relativePath.toLowerCase().includes(searchTerm) || 
                       searchTerm.includes(path.basename(f.relativePath, path.extname(f.relativePath)).toLowerCase()))
        .slice(0, 5)
        .map((f) => f.relativePath);

      let errorMsg = `File not found: ${docPath}`;
      if (suggestions.length > 0) {
        errorMsg += `\n\nDid you mean one of these?\n${suggestions.map(s => `  - ${s}`).join("\n")}`;
      }

      return {
        content: errorMsg,
        fullPath,
        exists: false,
      };
    }

    const content = fs.readFileSync(fullPath, "utf-8");

    return {
      content,
      fullPath,
      exists: true,
    };
  },
});

/**
 * Search docs tool - Searches documentation files by keyword
 */
export const searchDocsTool = createTool({
  id: "search-docs",
  description: `Searches documentation files for a keyword or phrase.
Returns matching files with relevant snippets.
Use this to find documentation related to a specific topic.`,
  inputSchema: z.object({
    repoPath: z.string().describe("Path to the cloned repository"),
    query: z.string().describe("Search query - keyword or phrase to search for"),
    maxResults: z.number().optional().describe("Maximum number of results to return (default: 10)"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        file: z.string().describe("Relative path to the file"),
        matches: z.array(
          z.object({
            line: z.number().describe("Line number"),
            content: z.string().describe("Line content with match"),
          })
        ),
        score: z.number().describe("Relevance score (number of matches)"),
      })
    ),
    totalMatches: z.number().describe("Total number of matches found"),
  }),
  execute: async ({ repoPath, query, maxResults = 10 }) => {
    const docsPath = getDocsPath(repoPath);

    if (!docsPath) {
      return {
        results: [],
        totalMatches: 0,
      };
    }

    const files = findMarkdownFiles(docsPath, docsPath);
    const searchTerms = query.toLowerCase().split(/\s+/);
    const results: {
      file: string;
      matches: { line: number; content: string }[];
      score: number;
    }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file.path, "utf-8");
      const lines = content.split("\n");
      const matches: { line: number; content: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const lineLower = lines[i].toLowerCase();
        if (searchTerms.some((term) => lineLower.includes(term))) {
          matches.push({
            line: i + 1,
            content: lines[i].slice(0, 200), // Truncate long lines
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          file: file.relativePath,
          matches: matches.slice(0, 5), // Limit matches per file
          score: matches.length,
        });
      }
    }

    // Sort by score (most matches first)
    results.sort((a, b) => b.score - a.score);

    const topResults = results.slice(0, maxResults);
    const totalMatches = results.reduce((sum, r) => sum + r.score, 0);

    return {
      results: topResults,
      totalMatches,
    };
  },
});

// Export all docs tools
export const docsTools = {
  listDocsTool,
  readDocTool,
  searchDocsTool,
};
