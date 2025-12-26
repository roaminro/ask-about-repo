import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { askAboutRepoWorkflow } from "./workflows/ask-about-repo";
import { codebaseAgent } from "./agents/codebase-agent";
import { Observability } from "@mastra/observability";
import { askAboutRepoAgent } from "./agents/ask-about-repo-agent";

export const mastra = new Mastra({
  workflows: { askAboutRepoWorkflow },
  agents: { codebaseAgent, askAboutRepoAgent },
  storage: new LibSQLStore({
    id: "mastra-storage",
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: "file:../../mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: process.env.NODE_ENV === "development" ? "debug" : "info",
  }),
  observability: new Observability({
    default: { enabled: true },
  }),
});
