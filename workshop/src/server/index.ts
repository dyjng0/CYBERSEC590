import "./load-env";
import express from "express";
import { randomUUID } from "node:crypto";
import { shutdownController } from "./lifecycle";
import { userFacingError } from "./errors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ChatRequest } from "../shared/types";
import { runSupportConversation } from "./support-agent";
import { env, provider, isLangfuseConfigured } from "./env";
import { DEFAULT_SUPPORT_CONTEXT } from "./support-data";

// Tracing exercise: initialize the Langfuse exporter here (STUDENT-LAB.md, step 1).
const instanceId = randomUUID();
let busy = false;

const requestSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.union([z.literal("user"), z.literal("assistant")]),
        content: z.string().min(1),
        timestamp: z.string()
      })
    )
    .min(1)
});

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    provider: provider.label,
    instanceId,
    modelCredentialsPresent: provider.credentialsPresent,
    model: env.openaiModel,
    langfuseCredentialsPresent: isLangfuseConfigured()
  });
});

app.get("/api/support-context", (_request, response) => {
  response.json(DEFAULT_SUPPORT_CONTEXT);
});

app.post("/api/chat", async (request, response) => {
  if (busy) { response.status(429).send("Another question is being answered. Please wait for it to finish."); return; }
  busy = true;
  try {
    const payload = requestSchema.parse(request.body) as ChatRequest;
    const result = await runSupportConversation(payload);
    response.json(result);
  } catch (error) {
    response.status(400).send(userFacingError(error));
  } finally {
    busy = false;
  }
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(currentDir, "../../dist");

app.use(express.static(clientDist));
app.use((_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

const server = app.listen(env.port, "127.0.0.1", () => {
  console.log(`Dad IT Support Agent server listening on http://127.0.0.1:${env.port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownController.abort();
  const watchdog = setTimeout(() => process.exit(1), 20000);
  watchdog.unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Tracing exercise: flush the exporter and shut down the SDK here.
  } catch {
    console.error("Shutdown could not finish cleanly. Check the server logs.");
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
