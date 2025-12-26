import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// Cache directory for cloned repos
const REPOS_DIR = path.join(process.cwd(), "../../.repos");

/**
 * Extract owner and repo name from a git URL
 * Handles: https://github.com/user/repo.git, git@github.com:user/repo.git, etc.
 * Returns "owner/repo" format to avoid conflicts between different users' repos
 */
function getRepoIdentifier(repoUrl: string): string {
  // Remove trailing .git if present
  const cleanUrl = repoUrl.replace(/\.git$/, "");
  // Get the last two parts of the URL (owner/repo)
  const parts = cleanUrl.split(/[\/:]/).filter(Boolean);
  if (parts.length >= 2) {
    const repo = parts[parts.length - 1];
    const owner = parts[parts.length - 2];
    return `${owner}/${repo}`;
  }
  return parts[parts.length - 1] || "repo";
}

/**
 * Get the local path for a cloned repository
 * Uses owner/repo format to avoid conflicts between different users' repos
 * If a branch is specified, include it in the path to allow multiple branches
 */
function getRepoPath(repoUrl: string, branch?: string): string {
  const repoId = getRepoIdentifier(repoUrl);
  if (branch) {
    // Sanitize branch name for filesystem (replace / with -)
    const safeBranch = branch.replace(/\//g, "-");
    return path.join(REPOS_DIR, `${repoId}@${safeBranch}`);
  }
  return path.join(REPOS_DIR, repoId);
}

/**
 * Get the current branch of a git repository
 */
function getCurrentBranch(repoPath: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a valid clone exists at the path
 */
function cloneExists(repoPath: string, branch?: string): boolean {
  try {
    const gitDir = path.join(repoPath, ".git");
    if (!fs.existsSync(gitDir)) {
      return false;
    }

    // If a branch is specified, check we're on the right branch
    if (branch) {
      const currentBranch = getCurrentBranch(repoPath);
      if (currentBranch !== branch) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Step 1: Clone the repository if needed
 *
 * This step checks if the repo is already cloned.
 * If not, it clones the repository.
 * To force a fresh clone, delete the .repos/<repo-name> folder manually.
 */
const cloneRepoStep = createStep({
  id: "clone-repo",
  description: "Clone a git repository if not already cached",
  inputSchema: z.object({
    repoUrl: z.url().describe("The git repository URL to clone"),
    question: z.string().describe("The question to ask about the codebase"),
    branch: z
      .string()
      .optional()
      .describe("The branch to clone (default: repository's default branch)"),
  }),
  outputSchema: z.object({
    repoPath: z.string().describe("Local path to the cloned repository"),
    question: z.string().describe("The question to ask about the codebase"),
    branch: z.string().optional().describe("The branch that was cloned"),
  }),
  execute: async ({ inputData }) => {
    const { repoUrl, question, branch } = inputData;

    // Ensure repos directory exists
    if (!fs.existsSync(REPOS_DIR)) {
      fs.mkdirSync(REPOS_DIR, { recursive: true });
    }

    const repoPath = getRepoPath(repoUrl, branch);

    // Check if we already have this clone
    if (cloneExists(repoPath, branch)) {
      return {
        repoPath,
        question,
        branch,
      };
    }

    // Clone the repository
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }

    // Build clone command with optional branch
    const cloneArgs = ["clone", "--depth", "1"];
    if (branch) {
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(repoUrl, repoPath);

    const result = spawnSync("git", cloneArgs, {
      encoding: "utf-8",
      timeout: 300000, // 5 minutes timeout for large repos
    });

    if (result.status !== 0) {
      throw new Error(
        `Failed to clone repository: ${result.stderr || result.error}`
      );
    }

    return {
      repoPath,
      question,
      branch,
    };
  },
});

/**
 * Step 2: Ask the codebase agent a question about the repository
 *
 * This step uses the codebase agent to answer questions about the cloned repository.
 */
const askAgentStep = createStep({
  id: "ask-agent",
  description: "Ask the codebase agent a question about the cloned repository",
  inputSchema: z.object({
    repoPath: z.string().describe("Local path to the cloned repository"),
    question: z.string().describe("The question to ask about the codebase"),
    branch: z.string().optional().describe("The branch that was cloned"),
  }),
  outputSchema: z.object({
    answer: z.string().describe("The agent's answer to the question"),
    repoPath: z
      .string()
      .describe("The path to the repository that was analyzed"),
    branch: z.string().optional().describe("The branch that was analyzed"),
  }),
  execute: async ({ inputData, mastra }) => {
    const { repoPath, question, branch } = inputData;

    // Get the codebase agent
    const agent = mastra?.getAgent("codebaseAgent");

    if (!agent) {
      throw new Error(
        "Codebase agent not found. Make sure it's registered in Mastra."
      );
    }

    // Create a prompt that includes the repo context
    const branchInfo = branch ? ` (branch: ${branch})` : "";
    const prompt = `You are analyzing a codebase located at: ${repoPath}${branchInfo}

The user's question is:
${question}

## Instructions

Use repoPath = "${repoPath}" with all tools.

**If this is a "how to" or conceptual question:**
1. First use search-docs(repoPath, query) to find relevant documentation
2. Use list-docs(repoPath) to see available docs structure  
3. Use read-doc(repoPath, docPath) to read relevant documentation
4. Provide the answer based on official documentation

**If this is a "where is" or implementation question:**
1. Use list(directory: repoPath) to understand project structure
2. Use grep(pattern, directory: repoPath) to find relevant code
3. Use read(filePath) to examine the code
4. Provide the answer with file locations and code snippets

**For questions that need both:**
- Start with documentation for conceptual understanding
- Then use code search to show implementation details

Provide a clear, helpful answer with references to specific files.`;

    // Generate the response
    const response = await agent.generate(prompt, {
      maxSteps: 100,
    });

    return {
      answer: response.text,
      repoPath,
      branch,
    };
  },
});

/**
 * Ask About Repo Workflow
 *
 * This workflow:
 * 1. Takes a repository URL, optional branch, and a question as input
 * 2. Clones the repository (or uses cached clone if it exists)
 * 3. Uses the codebase agent to answer the question using docs and code
 * 4. Returns the agent's answer
 *
 * To force a fresh clone, manually delete the .repos/<repo-name> folder.
 *
 * Usage:
 * ```typescript
 * const workflow = mastra.getWorkflow("askAboutRepoWorkflow");
 * const run = await workflow.createRunAsync();
 * const result = await run.start({
 *   inputData: {
 *     repoUrl: "https://github.com/mastra-ai/mastra",
 *     question: "How do I create an agent?",
 *     branch: "main", // Optional: specific branch
 *   }
 * });
 * console.log(result.result?.answer);
 * ```
 */
export const askAboutRepoWorkflow = createWorkflow({
  id: "ask-about-repo",
  description:
    "Clone a git repository and answer questions about its code and documentation",
  inputSchema: z.object({
    repoUrl: z
      .url()
      .default("https://github.com/mastra-ai/mastra")
      .describe("The git repository URL to clone"),
    question: z.string().describe("The question to ask about the codebase"),
    branch: z
      .string()
      .optional()
      .describe("The branch to clone (default: repository's default branch)"),
  }),
  outputSchema: z.object({
    answer: z.string().describe("The agent's answer to the question"),
    repoPath: z
      .string()
      .describe("The path to the repository that was analyzed"),
    branch: z.string().optional().describe("The branch that was analyzed"),
  }),
})
  .then(cloneRepoStep)
  .then(askAgentStep)
  .commit();
