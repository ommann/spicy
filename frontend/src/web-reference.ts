/** Explicit web URLs, plus bare domains with common web suffixes. */
export function webReference(text: string): string | undefined {
  if (/\s/.test(text)) return undefined;
  const explicit = /^https?:\/\//i.test(text);
  if (!explicit && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|dev|app|ai|co|uk|de|fi|info|me)(?::\d+)?(?:[/?#].*)?$/i.test(text)) return undefined;
  try {
    const url = new URL(explicit ? text : `https://${text}`);
    return url.hostname ? url.href : undefined;
  } catch {
    return undefined;
  }
}
