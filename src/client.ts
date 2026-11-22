import {
  CLEAR_EXTERNAL_ID_KEY_PREFIX,
  DEFAULT_API_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOKEN_TIMEOUT_MS,
  LOG_PREFIX,
  SECRET_KEY_PREFIX,
  STORAGE_KEY_PREFIX,
  TABLET_MIN_SHORTEST_SIDE_DP,
} from "./constants";
import { postJson } from "./helpers/http";
import { loadModules } from "./helpers/modules";
import { acquireWithTimeout, detectBackend, devicePlatform } from "./helpers/push";
import { TokenStore } from "./helpers/storage";
import type {
  ActionResult,
  ClientConfig,
  HttpOutcome,
  InitOptions,
  OptionalModules,
  RegisterResult,
  ReactNativeModule,
  ResetResult,
} from "./types";
import { isRecord, stringField, trimSlash } from "./utils";

/**
 * The configuration a queued operation runs with, captured when it is queued.
 * init() bumps the generation, so an operation that outlives a re-init keeps
 * using its own api key and storage keys and drops its results.
 */
interface Snapshot {
  generation: number;
  config: ClientConfig;
  modules: OptionalModules;
  store: TokenStore;
  tokenKey: string;
  clearKey: string;
}

export class ReachBellClient {
  private config: ClientConfig | null = null;
  private modules: OptionalModules | null = null;
  private store: TokenStore | null = null;
  /**
   * register() and reset() run one at a time, in call order, on this queue.
   * Nothing on it ever waits for a later entry, so it cannot deadlock.
   */
  private queue: Promise<void> = Promise.resolve();
  private pending: Promise<RegisterResult> | null = null;
  private pendingId = "";
  /** The newest queued reset; identify/tag/untag wait for the one present when they are called. */
  private resetting: Promise<void> | null = null;
  /** Bumped by every init(); operations from an older generation drop their results. */
  private generation = 0;

  init(options: InitOptions): void {
    this.generation += 1;
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
    const tokenTimeoutMs =
      typeof options.tokenTimeoutMs === "number" && options.tokenTimeoutMs > 0 ? options.tokenTimeoutMs : DEFAULT_TOKEN_TIMEOUT_MS;
    this.config = {
      apiKey,
      apiUrl: trimSlash(options.apiUrl?.trim() || DEFAULT_API_URL),
      timeoutMs,
      tokenTimeoutMs,
      debug: options.debug === true,
    };
    this.modules = loadModules();
    this.store = new TokenStore(this.modules.asyncStorage);
    this.queue = Promise.resolve();
    this.pending = null;
    this.pendingId = "";
    this.resetting = null;
    this.log("initialized", { apiUrl: this.config.apiUrl, persistent: this.store.persistent });
  }

  register(externalId?: string): Promise<RegisterResult> {
    const id = typeof externalId === "string" ? externalId.trim() : "";
    // Join a register() in flight unless this call brings a different
    // externalId; then queue a follow-up so the newest id is applied.
    if (this.pending && (!id || id === this.pendingId)) return this.pending;
    const snap = this.snapshot();
    const run = this.enqueue(() => this.doRegister(id, snap))
      .catch((): RegisterResult => ({ success: false, reason: "network_error" }))
      .finally(() => {
        if (this.pending === run) {
          this.pending = null;
          this.pendingId = "";
        }
      });
    this.pending = run;
    this.pendingId = id;
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
    const snap = this.snapshot();
    if (!snap) return null;
    try {
      return await snap.store.get(snap.tokenKey);
    } catch {
      return null;
    }
  }

  /**
   * Logout. Waits for a register() in flight, unlinks the user from the stored
   * token with `POST /subscribers/unidentify` (best effort: failures are
   * ignored), then clears the stored token. register(), identify(), tag() and
   * untag() called meanwhile wait for it.
   */
  unregister(): Promise<ResetResult> {
    // A register() already queued runs first; one called after this waits for
    // the reset, because both go through the same queue.
    this.pending = null;
    this.pendingId = "";
    const snap = this.snapshot();
    const run = this.enqueue(() => this.doReset(snap));
    const settled = run.then(noop, noop);
    this.resetting = settled;
    void settled.then(() => {
      if (this.resetting === settled) this.resetting = null;
    });
    return run.catch((): ResetResult => ({ ok: true }));
  }

  reset(): Promise<ResetResult> {
    return this.unregister();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(noop, noop);
    return run;
  }

  private async doReset(snap: Snapshot | null): Promise<ResetResult> {
    if (!snap || this.isStale(snap)) return { ok: true };
    const { config, store, tokenKey, clearKey } = snap;
    // C1a: the next register() without an externalId sends externalId: null,
    // which repairs the server if the unidentify below never arrives.
    await store.set(clearKey, "1").catch(() => undefined);
    let token: string | null = null;
    try {
      token = await store.get(tokenKey);
    } catch {
      token = null;
    }
    if (token) {
      const outcome = await postJson(config, "/subscribers/unidentify", { token }).catch(
        (): HttpOutcome => ({ kind: "network" }),
      );
      this.log("unidentify", mapAction(outcome));
    }
    // A re-init meanwhile owns local state now; leave its token alone.
    if (this.isStale(snap)) return { ok: true };
    try {
      await store.remove(tokenKey);
    } catch {
      return { ok: true };
    }
    this.log("cleared stored token");
    return { ok: true };
  }

  private async doRegister(id: string, snap: Snapshot | null): Promise<RegisterResult> {
    if (!snap) return { success: false, reason: "sdk_not_initialized" };
    if (this.isStale(snap)) return { success: false, reason: "reinitialized" };
    const { config, modules, store, tokenKey, clearKey } = snap;

    const platform = devicePlatform(modules.reactNative);
    if (!platform) return { success: false, reason: "unsupported_platform" };

    const backend = detectBackend(modules);
    if (!backend) return { success: false, reason: "no_push_module" };
    this.log(`acquiring token via ${backend.name}`);

    const acquired = await acquireWithTimeout(backend, platform, config.tokenTimeoutMs);
    if (this.isStale(snap)) return { success: false, reason: "reinitialized" };
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
      osVersion: osVersion(rn, platform),
      device: deviceKind(rn, platform),
    };
    if (id) body.externalId = id;
    else if (await store.get(clearKey).catch(() => null)) body.externalId = null;
    // C2: on a token refresh, the API moves tags and externalId from the
    // previously registered token to this one and deactivates the old row.
    const previousToken = await store.get(tokenKey).catch(() => null);
    if (previousToken && previousToken !== token) body.previousToken = previousToken;

    if (this.isStale(snap)) return { success: false, reason: "reinitialized" };
    const outcome = await postJson(config, "/subscribers", body);
    // Registered under the old api key, but a re-init owns local state now.
    if (this.isStale(snap)) return { success: false, reason: "reinitialized" };
    if (outcome.kind === "timeout") return { success: false, reason: "timed_out" };
    if (outcome.kind === "network") return { success: false, reason: "network_error" };
    if (!outcome.ok) {
      this.log("subscribe failed", outcome.status, outcome.body);
      return { success: false, reason: `subscribe_failed_${outcome.status}` };
    }

    await store.set(tokenKey, token);
    await store.remove(clearKey).catch(() => undefined);
    const subscriberId = stringField(outcome.body, "_id");
    this.log("registered", { tokenType, subscriberId });
    return { success: true, token, tokenType, ...(subscriberId && { subscriberId }) };
  }

  private async action(path: string, build: (token: string) => Record<string, unknown>): Promise<ActionResult> {
    try {
      // Wait for the reset queued when this was called; not for later ones.
      const resetting = this.resetting;
      if (resetting) await resetting;
      const snap = this.snapshot();
      if (!snap) return { ok: false, reason: "sdk_not_initialized" };
      const token = await snap.store.get(snap.tokenKey);
      if (!token) return { ok: false, reason: "no_subscription" };
      const result = mapAction(await postJson(snap.config, path, build(token)));
      this.log(path, result);
      return result;
    } catch {
      return { ok: false, reason: "network_error" };
    }
  }

  private snapshot(): Snapshot | null {
    const { config, modules, store } = this;
    if (!config || !modules || !store) return null;
    return {
      generation: this.generation,
      config,
      modules,
      store,
      tokenKey: `${STORAGE_KEY_PREFIX}${config.apiKey}`,
      clearKey: `${CLEAR_EXTERNAL_ID_KEY_PREFIX}${config.apiKey}`,
    };
  }

  private isStale(snap: Snapshot): boolean {
    return snap.generation !== this.generation;
  }

  private log(...args: unknown[]): void {
    if (this.config?.debug) console.log(LOG_PREFIX, ...args);
  }
}

function noop(): void {
  return undefined;
}

/** Android's Platform.Version is the API level; Platform.constants.Release is the OS version ("14"). */
function osVersion(rn: ReactNativeModule | null, platform: "ios" | "android"): string {
  if (!rn) return "";
  const release = platform === "android" ? rn.Platform.constants?.Release : undefined;
  if (typeof release === "string" && release) return release;
  return String(rn.Platform.Version ?? "");
}

/**
 * "tablet" for an iPad, or an Android device whose shortest screen side is at
 * least 600dp (Android's sw600dp tablet bucket); "mobile" otherwise or when
 * React Native gives no answer.
 */
function deviceKind(rn: ReactNativeModule | null, platform: "ios" | "android"): string {
  if (!rn) return "mobile";
  if (platform === "ios") return rn.Platform.isPad === true ? "tablet" : "mobile";
  try {
    const screen = rn.Dimensions?.get("screen");
    if (screen && Math.min(screen.width, screen.height) >= TABLET_MIN_SHORTEST_SIDE_DP) return "tablet";
  } catch {
    return "mobile";
  }
  return "mobile";
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
