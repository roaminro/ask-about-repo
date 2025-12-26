import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

// Default patterns to ignore when listing/searching
const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
];

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

/**
 * Glob tool - Fast file pattern matching
 * Finds files matching glob patterns like "**\/*.ts" or "src/**\/*.tsx"
 */
export const globTool = createTool({
  id: "glob",
  description: `Fast file pattern matching tool for finding files by name patterns.
Supports glob patterns like "**/*.js", "src/**/*.ts", "*.{ts,tsx}".
Returns matching file paths sorted by modification time.
Use this when you need to find files by name patterns.`,
  inputSchema: z.object({
    pattern: z.string().describe("The glob pattern to match files against (e.g., '**/*.ts', 'src/**/*.tsx')"),
    directory: z
      .string()
      .optional()
      .describe("The directory to search in. Defaults to current working directory."),
  }),
  outputSchema: z.object({
    files: z.array(z.string()).describe("Array of matching file paths"),
    count: z.number().describe("Number of files found"),
    truncated: z.boolean().describe("Whether results were truncated"),
  }),
  execute: async (inputData) => {
    const { pattern, directory } = inputData;
    const searchDir = directory || process.cwd();
    const limit = 100;

    try {
      // Use find with glob pattern or ripgrep if available
      let files: string[] = [];

      // Try using ripgrep's --files with glob (fastest)
      try {
        const result = spawnSync("rg", ["--files", "--glob", pattern], {
          cwd: searchDir,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });

        if (result.status === 0 && result.stdout) {
          files = result.stdout
            .trim()
            .split("\n")
            .filter((f) => f.length > 0)
            .map((f) => path.resolve(searchDir, f));
        }
      } catch {
        // Fallback to find command with pattern conversion
        const findPattern = pattern
          .replace(/\*\*/g, "")
          .replace(/\*/g, "*");

        const result = spawnSync("find", [searchDir, "-name", findPattern, "-type", "f"], {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });

        if (result.status === 0 && result.stdout) {
          files = result.stdout
            .trim()
            .split("\n")
            .filter((f) => f.length > 0);
        }
      }

      // Filter out ignored patterns
      files = files.filter((f) => {
        const relative = path.relative(searchDir, f);
        return !IGNORE_PATTERNS.some((ignore) => relative.includes(ignore.replace("/", "")));
      });

      // Get modification times for sorting
      const filesWithMtime = files.slice(0, limit * 2).map((filePath) => {
        try {
          const stats = fs.statSync(filePath);
          return { path: filePath, mtime: stats.mtime.getTime() };
        } catch {
          return { path: filePath, mtime: 0 };
        }
      });

      // Sort by modification time (newest first)
      filesWithMtime.sort((a, b) => b.mtime - a.mtime);

      const truncated = filesWithMtime.length > limit;
      const finalFiles = filesWithMtime.slice(0, limit).map((f) => f.path);

      return {
        files: finalFiles,
        count: finalFiles.length,
        truncated,
      };
    } catch (error) {
      return {
        files: [],
        count: 0,
        truncated: false,
      };
    }
  },
});

/**
 * Grep tool - Fast content search
 * Searches file contents using regular expressions
 */
export const grepTool = createTool({
  id: "grep",
  description: `Fast content search tool that searches file contents using regular expressions.
Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+").
Filter files by pattern with the include parameter (e.g., "*.js", "*.{ts,tsx}").
Returns file paths and line numbers with matches sorted by modification time.`,
  inputSchema: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    directory: z
      .string()
      .optional()
      .describe("The directory to search in. Defaults to current working directory."),
    include: z
      .string()
      .optional()
      .describe('File pattern to include in the search (e.g., "*.js", "*.{ts,tsx}")'),
  }),
  outputSchema: z.object({
    matches: z.array(
      z.object({
        file: z.string(),
        line: z.number(),
        content: z.string(),
      })
    ),
    count: z.number(),
    truncated: z.boolean(),
  }),
  execute: async (inputData) => {
    const { pattern, directory, include } = inputData;
    const searchDir = directory || process.cwd();
    const limit = 100;

    try {
      // Try using ripgrep (fastest)
      const args = ["-n", "-H", "--field-match-separator=|", "--regexp", pattern];

      if (include) {
        args.push("--glob", include);
      }

      // Add ignore patterns
      IGNORE_PATTERNS.forEach((ignore) => {
        args.push("--glob", `!${ignore}*`);
      });

      args.push(searchDir);

      const result = spawnSync("rg", args, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      if (result.status === 1) {
        // No matches found
        return { matches: [], count: 0, truncated: false };
      }

      if (result.status !== 0 && result.status !== 1) {
        // Fall back to grep
        const grepArgs = ["-rn", "-E", pattern];
        if (include) {
          grepArgs.push("--include", include);
        }
        grepArgs.push(searchDir);

        const grepResult = spawnSync("grep", grepArgs, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });

        if (!grepResult.stdout) {
          return { matches: [], count: 0, truncated: false };
        }

        const lines = grepResult.stdout.trim().split("\n").filter(Boolean);
        const matches = lines.slice(0, limit).map((line) => {
          const [filePath, lineNum, ...rest] = line.split(":");
          return {
            file: filePath,
            line: parseInt(lineNum, 10) || 0,
            content: rest.join(":").slice(0, MAX_LINE_LENGTH),
          };
        });

        return {
          matches,
          count: matches.length,
          truncated: lines.length > limit,
        };
      }

      // Parse ripgrep output
      const lines = (result.stdout || "").trim().split("\n").filter(Boolean);

      const matchesWithMtime = lines.map((line) => {
        const [filePath, lineNum, ...rest] = line.split("|");
        let mtime = 0;
        try {
          mtime = fs.statSync(filePath).mtime.getTime();
        } catch {}

        return {
          file: filePath,
          line: parseInt(lineNum, 10) || 0,
          content: rest.join("|").slice(0, MAX_LINE_LENGTH),
          mtime,
        };
      });

      // Sort by modification time
      matchesWithMtime.sort((a, b) => b.mtime - a.mtime);

      const truncated = matchesWithMtime.length > limit;
      const finalMatches = matchesWithMtime.slice(0, limit).map(({ mtime, ...m }) => m);

      return {
        matches: finalMatches,
        count: finalMatches.length,
        truncated,
      };
    } catch (error) {
      return { matches: [], count: 0, truncated: false };
    }
  },
});

/**
 * Read tool - Reads file contents
 * Reads a file with line numbers, supporting offset and limit for large files
 */
export const readTool = createTool({
  id: "read",
  description: `Reads a file from the filesystem with line numbers.
By default reads up to 2000 lines from the beginning.
You can specify offset and limit for reading specific portions of large files.
Lines longer than 2000 characters will be truncated.
Returns file contents with line numbers in "XXXXX| content" format.`,
  inputSchema: z.object({
    filePath: z.string().describe("The path to the file to read (absolute or relative)"),
    offset: z
      .number()
      .optional()
      .describe("The line number to start reading from (0-based). Default: 0"),
    limit: z
      .number()
      .optional()
      .describe("The number of lines to read. Default: 2000"),
  }),
  outputSchema: z.object({
    content: z.string().describe("File content with line numbers"),
    totalLines: z.number().describe("Total number of lines in the file"),
    hasMore: z.boolean().describe("Whether there are more lines after the read portion"),
  }),
  execute: async (inputData) => {
    let { filePath, offset = 0, limit = DEFAULT_READ_LIMIT } = inputData;

    // Resolve relative paths
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(process.cwd(), filePath);
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        // Try to suggest similar files
        const dir = path.dirname(filePath);
        const base = path.basename(filePath).toLowerCase();

        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          const suggestions = entries
            .filter(
              (entry) =>
                entry.toLowerCase().includes(base) || base.includes(entry.toLowerCase())
            )
            .slice(0, 3)
            .map((entry) => path.join(dir, entry));

          if (suggestions.length > 0) {
            throw new Error(
              `File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
            );
          }
        }

        throw new Error(`File not found: ${filePath}`);
      }

      // Check if it's a binary file
      const stats = fs.statSync(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        throw new Error(`File is too large (${Math.round(stats.size / 1024 / 1024)}MB). Max size: 10MB`);
      }

      // Read file
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const totalLines = lines.length;

      // Apply offset and limit
      const selectedLines = lines.slice(offset, offset + limit).map((line) => {
        return line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line;
      });

      // Format with line numbers
      const content = selectedLines
        .map((line, index) => {
          const lineNum = (index + offset + 1).toString().padStart(5, "0");
          return `${lineNum}| ${line}`;
        })
        .join("\n");

      const lastReadLine = offset + selectedLines.length;
      const hasMore = totalLines > lastReadLine;

      let output = "<file>\n";
      output += content;

      if (hasMore) {
        output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
      } else {
        output += `\n\n(End of file - total ${totalLines} lines)`;
      }
      output += "\n</file>";

      return {
        content: output,
        totalLines,
        hasMore,
      };
    } catch (error) {
      throw error;
    }
  },
});

/**
 * List tool - Lists directory contents
 * Lists files and directories in a tree-like structure
 */
export const listTool = createTool({
  id: "list",
  description: `Lists files and directories in a given path in a tree-like structure.
Returns a hierarchical view of the directory contents.
Automatically ignores common non-essential directories like node_modules, .git, etc.
Limited to 100 files to prevent overwhelming output.`,
  inputSchema: z.object({
    directory: z
      .string()
      .optional()
      .describe("The directory path to list. Defaults to current working directory."),
    ignore: z
      .array(z.string())
      .optional()
      .describe("Additional glob patterns to ignore"),
  }),
  outputSchema: z.object({
    tree: z.string().describe("Tree-like representation of directory contents"),
    fileCount: z.number().describe("Number of files found"),
    truncated: z.boolean().describe("Whether results were truncated"),
  }),
  execute: async (inputData) => {
    const { directory, ignore = [] } = inputData;
    const searchDir = path.resolve(process.cwd(), directory || ".");
    const limit = 100;

    try {
      // Combine default and custom ignore patterns
      const allIgnore = [...IGNORE_PATTERNS, ...ignore];

      // Use find to get files
      const args = [searchDir, "-type", "f"];

      // Add ignore patterns
      allIgnore.forEach((pattern) => {
        args.push("-not", "-path", `*/${pattern}*`);
      });

      const result = spawnSync("find", args, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      let files: string[] = [];
      if (result.status === 0 && result.stdout) {
        files = result.stdout
          .trim()
          .split("\n")
          .filter((f) => f.length > 0)
          .slice(0, limit);
      }

      // Build directory structure
      const dirs = new Set<string>();
      const filesByDir = new Map<string, string[]>();

      for (const file of files) {
        const relative = path.relative(searchDir, file);
        const dir = path.dirname(relative);
        const parts = dir === "." ? [] : dir.split(path.sep);

        // Add all parent directories
        for (let i = 0; i <= parts.length; i++) {
          const dirPath = i === 0 ? "." : parts.slice(0, i).join(path.sep);
          dirs.add(dirPath);
        }

        // Add file to its directory
        if (!filesByDir.has(dir)) {
          filesByDir.set(dir, []);
        }
        filesByDir.get(dir)!.push(path.basename(file));
      }

      // Render tree
      function renderDir(dirPath: string, depth: number): string {
        const indent = "  ".repeat(depth);
        let output = "";

        if (depth > 0) {
          output += `${indent}${path.basename(dirPath)}/\n`;
        }

        const childIndent = "  ".repeat(depth + 1);
        const children = Array.from(dirs)
          .filter((d) => path.dirname(d) === dirPath && d !== dirPath)
          .sort();

        // Render subdirectories first
        for (const child of children) {
          output += renderDir(child, depth + 1);
        }

        // Render files
        const dirFiles = filesByDir.get(dirPath) || [];
        for (const file of dirFiles.sort()) {
          output += `${childIndent}${file}\n`;
        }

        return output;
      }

      const truncated = files.length >= limit;
      const tree = `${searchDir}/\n` + renderDir(".", 0);

      return {
        tree,
        fileCount: files.length,
        truncated,
      };
    } catch (error) {
      return {
        tree: `Error listing directory: ${error}`,
        fileCount: 0,
        truncated: false,
      };
    }
  },
});

/**
 * Bash tool - Execute shell commands
 * Runs bash commands for operations not covered by other tools
 */
export const bashTool = createTool({
  id: "bash",
  description: `Executes a bash command and returns the output.
Use for operations that can't be done with other specialized tools.
Commands are run with a timeout to prevent hanging.
IMPORTANT: Only use this when other specialized tools (glob, grep, read, list) are not suitable.`,
  inputSchema: z.object({
    command: z.string().describe("The bash command to execute"),
    workdir: z
      .string()
      .optional()
      .describe("The working directory to run the command in. Defaults to current directory."),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds. Default: 30000 (30 seconds)"),
  }),
  outputSchema: z.object({
    stdout: z.string().describe("Standard output from the command"),
    stderr: z.string().describe("Standard error from the command"),
    exitCode: z.number().describe("Exit code of the command"),
  }),
  execute: async (inputData) => {
    const { command, workdir, timeout = 30000 } = inputData;

    try {
      const result = spawnSync("bash", ["-c", command], {
        cwd: workdir || process.cwd(),
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.status || 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: String(error),
        exitCode: 1,
      };
    }
  },
});

// Export all tools
export const codebaseTools = {
  globTool,
  grepTool,
  readTool,
  listTool,
  bashTool,
};
