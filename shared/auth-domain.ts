export const AUTH_SESSION_COOKIE = "dnd_session";
export const AUTH_STATE_COOKIE = "dnd_oauth_state";
export const AUTH_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const AUTH_OAUTH_STATE_DURATION_MS = 10 * 60 * 1_000;

export type AuthenticatedIdentity = {
  id: string;
  displayName: string;
  loginEmail: string;
  canCreateCampaigns: boolean;
  canUseQaSessions: boolean;
};

export function normalizeLoginEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : "";
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

export function cookieValue(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return "";
}

export function isLocalAuthRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
