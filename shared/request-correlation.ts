export const OPERATION_ID_HEADER = "x-operation-id";
export const REQUEST_ID_HEADER = "x-request-id";

const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

export function cleanCorrelationId(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";
  return CORRELATION_ID_PATTERN.test(cleaned) ? cleaned : null;
}

export function correlationSampleSelected(id: string, denominator: number): boolean {
  const boundedDenominator = Math.max(1, Math.trunc(denominator));
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % boundedDenominator === 0;
}

export function requestOutcome(status: number): "success" | "conflict" | "rate_limited" | "client_error" | "server_error" {
  if (status >= 500) return "server_error";
  if (status === 429) return "rate_limited";
  if (status === 409) return "conflict";
  if (status >= 400) return "client_error";
  return "success";
}

export function errorReference(requestId: string | null): string {
  const cleaned = cleanCorrelationId(requestId);
  return cleaned ? ` Reference: ${cleaned.slice(0, 8)}.` : "";
}
