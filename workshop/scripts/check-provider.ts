import OpenAI from "openai";
import { env, provider } from "../src/server/env";
import { requireProviderKey } from "../src/server/provider-config";
import { userFacingError } from "../src/server/errors";
import { probe, probeJson } from "./probe";

async function main() {
  const mode = process.argv[2];
  if (!["models", "probe", "probe-json"].includes(mode)) throw new Error("Choose models, probe, or probe-json.");
  requireProviderKey(provider);
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, maxRetries: 0, timeout: env.chatTimeoutMs });
  const signal = AbortSignal.timeout(env.chatTimeoutMs);
  console.log(`Selected: ${provider.label} / ${provider.model}`);
  if (mode === "models") {
    const result = await client.models.list({ signal });
    result.data.map(item => item.id).sort().forEach(id => console.log(id));
    console.log(`Set ${provider.modelName} to an exact tool-capable model ID, then run probe. Model listing alone does not prove account access.`);
  } else if (mode === "probe") {
    await probe(client, provider.model, signal);
    console.log("PASS: structured tool request and final answer using its result (two model requests). No Langfuse traces are created by this connection probe.");
  } else {
    await probeJson(client, provider.model, signal);
    console.log("PASS: optional strict JSON response check (one model request).");
  }
}
main().catch(error => {
  console.error(error instanceof SyntaxError ? "The model returned invalid JSON. If this was probe-json, the optional check failed independently of tool calling." : userFacingError(error));
  process.exitCode = 1;
});
