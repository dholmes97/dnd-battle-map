export function bearerSecretMatches(authorization: string | null, configured: string | undefined): boolean {
  const expected = configured ?? "";
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  const supplied = match?.[1] ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_ALLOWLIST_ENTRIES = 16;

export function parseEmailAllowlist(configured: string | undefined): string[] {
  if (!configured) return [];
  const entries = configured.split(",").map((entry) => entry.trim().toLowerCase());
  if (
    entries.length === 0
    || entries.length > MAX_EMAIL_ALLOWLIST_ENTRIES
    || entries.some((entry) => !EMAIL_ADDRESS_PATTERN.test(entry))
  ) return [];
  return [...new Set(entries)];
}

export function emailSenderAllowed(sender: string, allowlist: readonly string[]): boolean {
  const normalizedSender = sender.trim().toLowerCase();
  if (!EMAIL_ADDRESS_PATTERN.test(normalizedSender)) return false;
  return allowlist.includes(normalizedSender);
}
