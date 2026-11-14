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

/** Upload routes accept one image of at most 5 MB (MAX_IMAGE_BYTES) plus a few small text fields. */
export const MAX_UPLOAD_BODY_BYTES = 6 * 1024 * 1024;

/**
 * Reads a multipart/form-data body without buffering more than `maxBytes`: the Content-Length header is checked before
 * anything is read, and the stream is counted while reading because a client may omit or understate the header.
 * Throws BodyTooLargeError when the body is too big and TypeError/SyntaxError when it is not valid form data.
 */
export async function readFormDataLimited(req: Request, maxBytes = MAX_UPLOAD_BODY_BYTES): Promise<FormData> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType)) throw new TypeError("not multipart/form-data");
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
  return new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData();
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
