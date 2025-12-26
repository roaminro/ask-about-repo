import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { askAboutRepoWorkflow } from "../workflows/ask-about-repo";

export const askAboutRepoAgent = new Agent({
  id: "ask-about-repo-agent",
  name: "ask-about-repo-agent",
  memory: new Memory(),
  description: "An agent that can answer questions about a git repository",
  instructions: "You are a helpful assistant that can answer questions about git repositories. Use the askAboutRepoWorkflow to clone a repo and answer questions about its code and documentation.",
  model: "openai/gpt-4o-mini",
  workflows: {
    askAboutRepoWorkflow,
  },
});