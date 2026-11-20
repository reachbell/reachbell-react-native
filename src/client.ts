import { DEFAULT_API_URL, DEFAULT_TIMEOUT_MS, LOG_PREFIX, SECRET_KEY_PREFIX, STORAGE_KEY_PREFIX } from "./constants";
import { postJson } from "./helpers/http";
import { loadModules } from "./helpers/modules";
import { detectBackend, devicePlatform } from "./helpers/push";
import { TokenStore } from "./helpers/storage";
import type {
  ActionResult,
  ClientConfig,
  HttpOutcome,
  InitOptions,
  OptionalModules,
  RegisterResult,
  ResetResult,
} from "./types";
import { isRecord, stringField, trimSlash } from "./utils";

export class ReachBellClient {
  private config: ClientConfig | null = null;
  private modules: OptionalModules | null = null;
  private store: TokenStore | null = null;
  private pending: Promise<RegisterResult> | null = null;

  init(options: InitOptions): void {
    const apiKey = typeof options?.apiKey === "string" ? options.apiKey.trim() : "";
    if (!apiKey) {
      this.config = null;
      this.store = null;
      console.warn(`${LOG_PREFIX} init() needs an apiKey; the SDK stays uninitialized.`);
      return;
    }
    if (apiKey.startsWith(SECRET_KEY_PREFIX)) {
      console.warn(`${LOG_PREFIX} you passed a secret key (rb_secret_). Ship only the public key (rb_live_) in your app.`);
    }
    const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.config = {
      apiKey,
      apiUrl: trimSlash(options.apiUrl?.trim() || DEFAULT_API_URL),
      timeoutMs,
      debug: options.debug === true,
    };
    this.modules = loadModules();
    this.store = new TokenStore(this.modules.asyncStorage);
    this.pending = null;
    this.log("initialized", { apiUrl: this.config.apiUrl, persistent: this.store.persistent });
  }

  register(externalId?: string): Promise<RegisterResult> {
    if (this.pending) return this.pending;
    const run = this.doRegister(externalId)
      .catch((): RegisterResult => ({ success: false, reason: "network_error" }))
      .finally(() => {
        this.pending = null;
      });
    this.pending = run;
    return run;
  }

  async identify(externalId: string): Promise<ActionResult> {
    return this.action("/subscribers/identify", (token) => ({ token, externalId }));
  }

  async tag(tags: string[] | string): Promise<ActionResult> {
    return this.action("/subscribers/tag", (token) => ({ token, tags: normalizeTags(tags) }));
  }

  async untag(tags: string[] | string): Promise<ActionResult> {
    return this.action("/subscribers/untag", (token) => ({ token, tags: normalizeTags(tags) }));
  }

  async getToken(): Promise<string | null> {
    if (!this.config || !this.store) return null;
    try {
      return await this.store.get(this.storageKey());
    } catch {
      return null;
    }
  }

  async unregister(): Promise<ResetResult> {
    if (this.config && this.store) {
      try {
        await this.store.remove(this.storageKey());
      } catch {
        return { ok: true };
      }
      this.log("cleared stored token");
    }
    return { ok: true };
  }

  reset(): Promise<ResetResult> {
    return this.unregister();
  }

  private async doRegister(externalId?: string): Promise<RegisterResult> {
    const config = this.config;
    const modules = this.modules;
    const store = this.store;
    if (!config || !modules || !store) return { success: false, reason: "sdk_not_initialized" };

    const platform = devicePlatform(modules.reactNative);
    if (!platform) return { success: false, reason: "unsupported_platform" };

    const backend = detectBackend(modules);
    if (!backend) return { success: false, reason: "no_push_module" };
    this.log(`acquiring token via ${backend.name}`);

    const acquired = await backend.acquire(platform);
    if (!acquired.ok) {
      this.log("token acquisition failed", acquired.reason);
      return { success: false, reason: acquired.reason };
    }
    const { token, tokenType } = acquired.value;

    const rn = modules.reactNative;
    const body: Record<string, unknown> = {
      token,
      tokenType,
      platform,
      os: platform === "ios" ? "iOS" : "Android",
      osVersion: rn ? String(rn.Platform.Version ?? "") : "",
      device: "mobile",
    };
    const id = typeof externalId === "string" ? externalId.trim() : "";
    if (id) body.externalId = id;

    const outcome = await postJson(config, "/subscribers", body);
    if (outcome.kind === "timeout") return { success: false, reason: "timed_out" };
    if (outcome.kind === "network") return { success: false, reason: "network_error" };
    if (!outcome.ok) {
      this.log("subscribe failed", outcome.status, outcome.body);
      return { success: false, reason: `subscribe_failed_${outcome.status}` };
    }

    await store.set(this.storageKey(), token);
    const subscriberId = stringField(outcome.body, "_id");
    this.log("registered", { tokenType, subscriberId });
    return { success: true, token, tokenType, ...(subscriberId && { subscriberId }) };
  }

  private async action(path: string, build: (token: string) => Record<string, unknown>): Promise<ActionResult> {
    try {
      const config = this.config;
      if (!config || !this.store) return { ok: false, reason: "sdk_not_initialized" };
      const token = await this.store.get(this.storageKey());
      if (!token) return { ok: false, reason: "no_subscription" };
      const result = mapAction(await postJson(config, path, build(token)));
      this.log(path, result);
      return result;
    } catch {
      return { ok: false, reason: "network_error" };
    }
  }

  private storageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this.config?.apiKey ?? ""}`;
  }

  private log(...args: unknown[]): void {
    if (this.config?.debug) console.log(LOG_PREFIX, ...args);
  }
}

function normalizeTags(tags: string[] | string): string[] {
  const list = Array.isArray(tags) ? tags : [tags];
  return list.filter((t): t is string => typeof t === "string");
}

function mapAction(outcome: HttpOutcome): ActionResult {
  if (outcome.kind === "timeout") return { ok: false, reason: "timed_out" };
  if (outcome.kind === "network") return { ok: false, reason: "network_error" };
  if (!outcome.ok) return { ok: false, reason: `server_${outcome.status}` };
  const body = outcome.body;
  if (isRecord(body) && body.success === false) {
    return { ok: false, reason: stringField(body, "reason") ?? "server_rejected" };
  }
  const updated = isRecord(body) && typeof body.updated === "boolean" ? body.updated : undefined;
  return updated === undefined ? { ok: true } : { ok: true, updated };
}
