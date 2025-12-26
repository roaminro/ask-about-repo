import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { repoQaWorkflow } from "./workflows/repo-qa-workflow";
import { codebaseAgent } from "./agents/codebase-agent";
import { Observability } from "@mastra/observability";
import { repoQaAgent } from "./agents/repo-qa-agent";

export const mastra = new Mastra({
  workflows: { repoQaWorkflow },
  agents: { codebaseAgent, repoQaAgent },
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
