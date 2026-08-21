export class RequestBodyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "RequestBodyError";
    this.code = code;
    this.status = status;
  }
}

export function parseContentLength(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readBoundedRequestBytes(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength === null) {
    throw new RequestBodyError("request_size_invalid", "The request Content-Length is invalid.", 400);
  }
  if (contentLength !== undefined && contentLength > maximumBytes) {
    throw new RequestBodyError("request_too_large", "The request body is too large.", 413);
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new RequestBodyError("request_too_large", "The request body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (contentLength !== undefined && contentLength !== byteLength) {
    throw new RequestBodyError("request_size_invalid", "The request body length does not match Content-Length.", 400);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedJsonObject(
  request: Request,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedRequestBytes(request, maximumBytes);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new RequestBodyError("json_invalid", "The request body must be a JSON object.", 400);
  }
}

export async function readBoundedFormData(
  request: Request,
  maximumBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new RequestBodyError("form_invalid", "The request body must be multipart form data.", 400);
  }
  const bytes = await readBoundedRequestBytes(request, maximumBytes);
  try {
    const body = new Uint8Array(bytes).buffer;
    return await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new RequestBodyError("form_invalid", "The multipart request could not be read.", 400);
  }
}
