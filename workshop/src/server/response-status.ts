export function assertCompleteResponse(response: { choices: { finish_reason?: string | null }[] }) {
  const reason = response.choices[0]?.finish_reason;
  if (reason === "length") {
    throw new Error("The model response was cut short by its output limit. Try a shorter question or another available model.");
  }
  if (reason === "content_filter") {
    throw new Error("The provider stopped this response with its content filter. Try a different in-scope question.");
  }
}
