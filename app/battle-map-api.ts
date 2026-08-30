import {
  errorReference,
  OPERATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/shared/request-correlation";

export const DEFAULT_API_TIMEOUT_MS = 12_000;
export const API_TIMEOUT_MESSAGE = "The request timed out. Please try again.";

type BattleMapApiOptions = RequestInit & { timeoutMs?: number };

export class BattleMapHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BattleMapHttpError";
    this.status = status;
  }
}

export function isUnauthorizedBattleMapError(error: unknown): error is BattleMapHttpError {
  return error instanceof BattleMapHttpError && error.status === 401;
}

export async function battleMapRequest<T>(
  url: string,
  options: BattleMapApiOptions,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal: callerSignal, ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const forwardCallerAbort = () => controller.abort(
    callerSignal?.reason ?? new DOMException("The request was cancelled.", "AbortError"),
  );
  if (callerSignal?.aborted) forwardCallerAbort();
  else callerSignal?.addEventListener("abort", forwardCallerAbort, { once: true });
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
        if (controller.signal.aborted) return;
        timedOut = true;
        controller.abort(new DOMException("The request timed out.", "TimeoutError"));
      }, timeoutMs)
    : null;
  try {
    const headers = new Headers(requestOptions.headers);
    if (!headers.has(OPERATION_ID_HEADER)) headers.set(OPERATION_ID_HEADER, crypto.randomUUID());
    const response = await fetch(url, {
      ...requestOptions,
      headers,
      signal: controller.signal,
    });
    return await consume(response);
  } catch (error) {
    if (timedOut) throw new Error(API_TIMEOUT_MESSAGE, { cause: error });
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  }
}

export async function battleMapApi<T>(url: string, options: BattleMapApiOptions = {}): Promise<T> {
  return battleMapRequest(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  }, async (response) => {
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      const reference = response.status >= 500
        ? errorReference(response.headers.get(REQUEST_ID_HEADER))
        : "";
      throw new BattleMapHttpError(`${data.error ?? "Request failed."}${reference}`, response.status);
    }
    return data;
  });
}
