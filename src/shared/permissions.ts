// A domain grant is stored as a `*.example.com` wildcard (matching the format of the seeded
// defaults), not the bare host — otherwise "whole domain" only ever matched the exact host the
// prompt happened to fire on (e.g. granting on "amazon.com" wouldn't cover "www.amazon.com").
// Shared by the permission card and plan-approval grants so both produce the same pattern.
export function domainPatternOf(host: string): string {
  const base = host.startsWith('www.') ? host.slice(4) : host;
  return `*.${base}`;
}
