import "./load-env";
import { resolveProvider } from "./provider-config";
export const provider = resolveProvider(process.env);
const timeoutSeconds = Number(process.env.CHAT_TIMEOUT_SECONDS ?? 90);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 180) {
  throw new Error("CHAT_TIMEOUT_SECONDS must be between 10 and 180.");
}
export const env = {
  port: Number(process.env.PORT ?? 8787),
  openaiApiKey: provider.apiKey,
  openaiBaseUrl: provider.baseURL,
  openaiModel: provider.model,
  chatTimeoutMs: timeoutSeconds * 1000,
  langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY?.trim() ?? "",
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY?.trim() ?? "",
  langfuseBaseUrl: process.env.LANGFUSE_BASE_URL?.trim() || "https://us.cloud.langfuse.com"
};
export function isLangfuseConfigured() {
  return Boolean(env.langfusePublicKey && env.langfuseSecretKey);
}
