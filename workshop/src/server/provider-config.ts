export type Provider = "ollama" | "duke";

export function resolveProvider(config: Record<string, string | undefined>) {
  const provider = (config.MODEL_PROVIDER ?? "ollama").trim().toLowerCase();
  if (provider !== "ollama" && provider !== "duke") {
    throw new Error("MODEL_PROVIDER must be ollama or duke in workshop/.env.");
  }
  const ollama = provider === "ollama";
  const keyName = ollama ? "OLLAMA_API_KEY" : "DUKE_API_KEY";
  const modelName = ollama ? "OLLAMA_MODEL" : "DUKE_MODEL";
  const apiKey = (config[keyName] ?? "").trim();
  const model = (config[modelName] ?? (ollama ? "gemma4:31b" : "gpt-4.1-mini")).trim();
  if (!model) throw new Error(`Set ${modelName} to an exact model ID from the models command.`);
  return {
    provider: provider as Provider,
    label: ollama ? "Ollama Cloud" : "Duke AI Gateway",
    baseURL: ollama ? "https://ollama.com/v1" : "https://litellm.oit.duke.edu/v1",
    apiKey, keyName, modelName, model,
    credentialsPresent: Boolean(apiKey && !/^(your|replace|example)/i.test(apiKey) && apiKey !== "ollama" && !apiKey.includes("..."))
  };
}

export function requireProviderKey(provider: ReturnType<typeof resolveProvider>) {
  if (!provider.credentialsPresent) throw new Error(`Set ${provider.keyName} in workshop/.env and restart the app.`);
}
