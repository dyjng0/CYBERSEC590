export function userFacingError(error: unknown): string {
  const value = error as { status?: number; name?: string; message?: string };
  if (value?.status === 401 || value?.status === 403) return "The selected provider rejected this key or model access. Check its key and account permissions, then run the probe.";
  if (value?.status === 429) return "The provider's usage or rate limit was reached. Wait and check your account allowance before trying again.";
  if (value?.status === 404) return "The selected model is unavailable. Run the models command and copy an exact model ID into workshop/.env.";
  if (value?.status) return `The model provider returned HTTP ${value.status}. Check its service status, model support, and the troubleshooting guide.`;
  if (/abort|timeout/i.test(value?.name ?? "")) return "The model request timed out or the app restarted. Wait a moment, then try a shorter question.";
  if (value?.name === "APIConnectionError") return "Cannot reach the model provider. Check your internet connection and its service status.";
  if (value?.name === "ZodError") return "The chat request is incomplete or invalid. Reload the page and try again.";
  return value?.message ?? "The request failed. Check the troubleshooting guide.";
}
