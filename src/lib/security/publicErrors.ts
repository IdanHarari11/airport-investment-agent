/**
 * Never return raw Error.message to clients — it may include env var names,
 * provider payloads, or stack-like strings.
 */

const SENSITIVE =
  /(api[_-]?key|secret|token|password|authorization|Bearer\s+\S+|sk-[a-zA-Z0-9_-]{10,}|xi-api-key)/i;

export function toPublicErrorMessage(error: unknown): {
  error: string;
  status: number;
} {
  const raw = error instanceof Error ? error.message : "Unknown error";
  const missingConfig =
    /required when|is required|not configured|API_KEY/i.test(raw);

  if (missingConfig) {
    return {
      error:
        "The server is missing required configuration. Ask the operator to check environment variables.",
      status: 503,
    };
  }

  if (SENSITIVE.test(raw)) {
    return {
      error: "The request could not be completed securely. Please try again.",
      status: 500,
    };
  }

  return {
    error: "The airport intelligence agent failed to process this request.",
    status: 500,
  };
}
