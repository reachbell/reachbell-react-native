export function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
}

export function interopDefault<T>(mod: unknown): T | null {
  if (mod === null || mod === undefined) return null;
  if (isRecord(mod) && "default" in mod && mod.default) return mod.default as T;
  return mod as T;
}

export function toNumber(value: number | string | undefined): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}
