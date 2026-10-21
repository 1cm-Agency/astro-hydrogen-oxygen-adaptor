// Character allowlist for IPv4 and IPv6 text (incl. IPv4-mapped), at most 45 characters.
const IP_SHAPE = /^[0-9a-fA-F.:]{1,45}$/;

/**
 * Reads a client IP from a possibly comma-separated header value (`oxygen-buyer-ip`,
 * `x-forwarded-for`): the first segment, trimmed, if it looks like an IP address.
 */
export function getClientIp(headerValue: string | null | undefined): string | undefined {
  const first = headerValue?.split(',')[0]?.trim();
  return first && IP_SHAPE.test(first) ? first : undefined;
}
