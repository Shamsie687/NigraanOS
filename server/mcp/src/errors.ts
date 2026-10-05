export type ErrorCode =
  | "invalid_input"
  | "unknown_reference"
  | "stale_reference"
  | "incident_unavailable"
  | "read_unavailable"
  | "read_budget_exceeded"
  | "timeout"
  | "invalid_token"
  | "access_denied"
  | "rate_limited"
  | "busy"
  | "invalid_grant"
  | "invalid_request";
const messages: Record<ErrorCode, string> = {
  invalid_input: "Unsupported tool input.",
  unknown_reference: "Reference unavailable.",
  stale_reference: "Request a fresh incident list.",
  incident_unavailable: "Incident unavailable.",
  read_unavailable: "Authorized read unavailable.",
  read_budget_exceeded: "Read budget exceeded; no exact total returned.",
  timeout: "Read timed out.",
  invalid_token: "Fresh authorization required.",
  access_denied: "Approved Operations consent required.",
  rate_limited: "Read limit reached. Retry later.",
  busy: "A read is already active.",
  invalid_grant: "Authorization cannot be completed.",
  invalid_request: "Invalid authorization request.",
};
export class SafeError extends Error {
  constructor(
    public code: ErrorCode,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(messages[code]);
  }
}
export function safe(error: unknown) {
  return error instanceof SafeError
    ? error
    : new SafeError("read_unavailable", 503);
}
