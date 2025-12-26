import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { repoQaWorkflow } from "../workflows/repo-qa-workflow";

export const repoQaAgent = new Agent({
  id: "repo-qa-agent",
  name: "repo-qa-agent",
  memory: new Memory(),
  description: "An agent that can answer questions about a repository",
  instructions: "You are a helpful assistant that can answer questions about a repository",
  model: "openai/gpt-4o-mini",
  workflows: {
    repoQaWorkflow,
  },
});