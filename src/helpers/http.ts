import type { ClientConfig, HttpOutcome } from "../types";
import { parseBody } from "../utils";

const TIMEOUT = Symbol("timeout");

export async function postJson(config: ClientConfig, path: string, body: unknown): Promise<HttpOutcome> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(TIMEOUT);
    }, config.timeoutMs);
  });

  const request = (async (): Promise<HttpOutcome> => {
    const response = await fetch(`${config.apiUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const text = await response.text();
    return { kind: "response", status: response.status, ok: response.ok, body: parseBody(text) };
  })();

  try {
    const result = await Promise.race([request, timeout]);
    if (result === TIMEOUT) {
      request.catch(() => undefined);
      return { kind: "timeout" };
    }
    return result;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") return { kind: "timeout" };
    return { kind: "network" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
