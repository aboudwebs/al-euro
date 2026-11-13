/** Small request helpers: a bounded JSON reader and the caller's IP address. */

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

/**
 * Reads a JSON body without buffering more than `maxBytes`. The Content-Length header is checked first, and the stream
 * is also counted while reading because a client may omit or understate the header.
 */
export async function readJsonLimited(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) throw new SyntaxError("empty body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return JSON.parse(text);
}

/** Best-effort client address for rate limiting. Cloudflare's header is set by the edge and cannot be spoofed by a client. */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "unknown").slice(0, 64);
}
