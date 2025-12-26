# Mastra Docs Bot

A Mastra-based AI agent that can clone git repositories and answer questions about their code and documentation.

## Features

- Clone any public git repository (with optional branch selection)
- Search and read documentation (markdown files)
- Navigate and search codebases (glob, grep, read)
- Answer "how to" questions using docs
- Answer "where is" questions using code search

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Add your API keys to .env
# ANTHROPIC_API_KEY=your-key-here
```

## Usage

### Development

```bash
pnpm dev
```

Opens the Mastra playground at http://localhost:4111 where you can chat with the agent.

### Using the Agent

The `codebaseAgent` expects a `repoPath` pointing to a cloned repository. Use the workflow to handle cloning automatically:

```typescript
import { mastra } from "./src/mastra";

const workflow = mastra.getWorkflow("askAboutRepoWorkflow");
const run = await workflow.createRunAsync();

const result = await run.start({
  inputData: {
    repoUrl: "https://github.com/mastra-ai/mastra",
    question: "How do I create an agent?",
    branch: "main", // optional
  },
});

console.log(result.result?.answer);
```

### Available Tools

| Tool | Description |
|------|-------------|
| `glob` | Find files by pattern (e.g., `**/*.ts`) |
| `grep` | Search file contents with regex |
| `read` | Read file contents with line numbers |
| `list` | List directory structure |
| `bash` | Execute shell commands |
| `list-docs` | List all documentation files |
| `read-doc` | Read a specific doc file |
| `search-docs` | Keyword search across docs |

## Project Structure

```
src/mastra/
├── agents/
│   ├── codebase-agent.ts    # Main agent with navigation tools
│   └── ask-about-repo-agent.ts
├── tools/
│   ├── codebase-tools.ts    # glob, grep, read, list, bash
│   └── docs-tools.ts        # list-docs, read-doc, search-docs
├── workflows/
│   └── ask-about-repo.ts    # Clone repo + ask agent workflow
└── index.ts                 # Mastra registration
```

## Cloned Repos

Repositories are cached in `.repos/` using the format:
- `.repos/owner/repo` (default branch)
- `.repos/owner/repo@branch` (specific branch)

To force a fresh clone, delete the corresponding folder.

## Configuration

- **Model:** `anthropic/claude-sonnet-4-5`
- **Storage:** LibSQL (file-based)
- **Memory:** Enabled for conversation context
