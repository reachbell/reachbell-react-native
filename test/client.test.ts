import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionalModules } from "../src/types";

const state = vi.hoisted(() => ({ modules: null as unknown }));

vi.mock("../src/helpers/modules", () => ({
  loadModules: () => state.modules,
}));

import { ReachBellClient } from "../src/client";
import * as ReachBell from "../src";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status?: number; body?: unknown }> = [{}]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    const payload = next.body ?? { _id: "sub_1" };
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status: next.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (k: string) => data.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn(async (k: string) => void data.delete(k)),
  };
}

function reactNative(OS = "ios", Version: number | string = "17.4", permission = "granted") {
  return {
    Platform: { OS, Version },
    PermissionsAndroid: {
      request: vi.fn(async () => permission),
      PERMISSIONS: { POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS" },
      RESULTS: { GRANTED: "granted" },
    },
  };
}

function expo(opts: { granted?: boolean; requestGranted?: boolean; type?: string; data?: string; throwToken?: boolean } = {}) {
  return {
    getPermissionsAsync: vi.fn(async () => ({ granted: opts.granted ?? true, status: opts.granted === false ? "undetermined" : "granted" })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: opts.requestGranted ?? false, status: opts.requestGranted ? "granted" : "denied" })),
    getDevicePushTokenAsync: vi.fn(async () => {
      if (opts.throwToken) throw new Error("no aps-environment");
      return { type: opts.type ?? "ios", data: opts.data ?? "a1b2c3d4" };
    }),
    getNotificationChannelsAsync: vi.fn(async () => []),
    setNotificationChannelAsync: vi.fn(async () => null),
    AndroidImportance: { DEFAULT: 3 },
  };
}

function firebaseNamespaced(opts: { status?: number; token?: string } = {}) {
  const instance = {
    requestPermission: vi.fn(async () => opts.status ?? 1),
    getToken: vi.fn(async () => opts.token ?? "fcm-token-1"),
    registerDeviceForRemoteMessages: vi.fn(async () => undefined),
    isDeviceRegisteredForRemoteMessages: false,
  };
  return { mod: { default: () => instance }, instance };
}

function firebaseModular(token = "fcm-modular") {
  const messaging = { app: "default" };
  return {
    getMessaging: vi.fn(() => messaging),
    requestPermission: vi.fn(async () => 1),
    getToken: vi.fn(async (m: unknown) => (m === messaging ? token : "")),
    registerDeviceForRemoteMessages: vi.fn(async () => undefined),
    isDeviceRegisteredForRemoteMessages: vi.fn(() => true),
  };
}

function setModules(partial: Partial<OptionalModules>) {
  state.modules = {
    reactNative: reactNative(),
    expoNotifications: null,
    firebaseMessaging: null,
    asyncStorage: null,
    ...partial,
  };
}

function client(options: Partial<{ apiUrl: string; timeoutMs: number }> = {}) {
  const c = new ReachBellClient();
  c.init({ apiKey: "rb_live_test", apiUrl: "https://api.test/", ...options });
  return c;
}

const json = (c: Call) => JSON.parse(String(c.init.body));
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

beforeEach(() => {
  setModules({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("returns sdk_not_initialized before init", async () => {
    const c = new ReachBellClient();
    expect(await c.register()).toEqual({ success: false, reason: "sdk_not_initialized" });
    expect(await c.identify("u1")).toEqual({ ok: false, reason: "sdk_not_initialized" });
    expect(await c.tag(["a"])).toEqual({ ok: false, reason: "sdk_not_initialized" });
    expect(await c.getToken()).toBeNull();
  });

  it("stays uninitialized without an api key and does not throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = new ReachBellClient();
    expect(() => c.init({ apiKey: "" })).not.toThrow();
    expect((await c.register()).reason).toBe("sdk_not_initialized");
  });

  it("registers an APNs token via expo-notifications on iOS", async () => {
    const storage = memoryStorage();
    const ex = expo({ type: "ios", data: "deadbeef" });
    setModules({ expoNotifications: ex, asyncStorage: storage });
    const m = mockFetch([{ body: { _id: "sub_42" } }]);

    const r = await client().register();

    expect(r).toEqual({ success: true, token: "deadbeef", tokenType: "apns", subscriberId: "sub_42" });
    expect(ex.requestPermissionsAsync).not.toHaveBeenCalled();
    const c = m.calls[0];
    expect(c.url).toBe("https://api.test/subscribers");
    expect(c.init.method).toBe("POST");
    expect(header(c, "x-api-key")).toBe("rb_live_test");
    expect(header(c, "content-type")).toBe("application/json");
    expect(json(c)).toMatchObject({ token: "deadbeef", tokenType: "apns", platform: "ios" });
    expect(json(c).externalId).toBeUndefined();
    expect(storage.data.get("reachbell:token:rb_live_test")).toBe("deadbeef");
  });

  it("registers an FCM token via expo-notifications on Android and creates a channel", async () => {
    const ex = expo({ granted: false, requestGranted: true, type: "android", data: "fcm-from-expo" });
    setModules({ reactNative: reactNative("android", 34), expoNotifications: ex });
    const m = mockFetch();

    const r = await client().register("user_42");

    expect(r.success).toBe(true);
    expect(r.tokenType).toBe("fcm");
    expect(ex.setNotificationChannelAsync).toHaveBeenCalledWith("default", expect.objectContaining({ importance: 3 }));
    expect(ex.requestPermissionsAsync).toHaveBeenCalled();
    expect(json(m.calls[0])).toMatchObject({ token: "fcm-from-expo", tokenType: "fcm", platform: "android", externalId: "user_42" });
  });

  it("registers an FCM token via @react-native-firebase/messaging on iOS", async () => {
    const fb = firebaseNamespaced({ token: "fcm-ios" });
    setModules({ firebaseMessaging: fb.mod });
    const m = mockFetch();

    const r = await client().register();

    expect(r).toMatchObject({ success: true, token: "fcm-ios", tokenType: "fcm" });
    expect(fb.instance.requestPermission).toHaveBeenCalled();
    expect(fb.instance.registerDeviceForRemoteMessages).toHaveBeenCalled();
    expect(json(m.calls[0])).toMatchObject({ token: "fcm-ios", tokenType: "fcm", platform: "ios" });
  });

  it("uses the modular firebase API on Android and asks POST_NOTIFICATIONS on API 33+", async () => {
    const rn = reactNative("android", 33);
    const fb = firebaseModular("fcm-android");
    setModules({ reactNative: rn, firebaseMessaging: fb });
    const m = mockFetch();

    const r = await client().register();

    expect(r).toMatchObject({ success: true, token: "fcm-android", tokenType: "fcm" });
    expect(rn.PermissionsAndroid.request).toHaveBeenCalledWith("android.permission.POST_NOTIFICATIONS");
    expect(fb.requestPermission).not.toHaveBeenCalled();
    expect(json(m.calls[0])).toMatchObject({ platform: "android", tokenType: "fcm" });
  });

  it("prefers firebase when both backends are installed", async () => {
    const ex = expo();
    const fb = firebaseNamespaced();
    setModules({ expoNotifications: ex, firebaseMessaging: fb.mod });
    mockFetch();
    const r = await client().register();
    expect(r.tokenType).toBe("fcm");
    expect(ex.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });

  it("returns no_push_module when neither backend is installed", async () => {
    const m = mockFetch();
    expect(await client().register()).toEqual({ success: false, reason: "no_push_module" });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("returns unsupported_platform off iOS and Android", async () => {
    setModules({ reactNative: reactNative("web"), expoNotifications: expo() });
    expect(await client().register()).toEqual({ success: false, reason: "unsupported_platform" });
  });

  it("returns permission_denied when expo permission is refused", async () => {
    setModules({ expoNotifications: expo({ granted: false, requestGranted: false }) });
    const m = mockFetch();
    expect(await client().register()).toEqual({ success: false, reason: "permission_denied" });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("returns permission_denied when firebase iOS authorization is denied", async () => {
    setModules({ firebaseMessaging: firebaseNamespaced({ status: 0 }).mod });
    expect(await client().register()).toEqual({ success: false, reason: "permission_denied" });
  });

  it("returns permission_denied when Android 13 POST_NOTIFICATIONS is refused", async () => {
    setModules({ reactNative: reactNative("android", 34, "denied"), firebaseMessaging: firebaseNamespaced().mod });
    expect(await client().register()).toEqual({ success: false, reason: "permission_denied" });
  });

  it("returns no_token when the device token cannot be read", async () => {
    setModules({ expoNotifications: expo({ throwToken: true }) });
    expect(await client().register()).toEqual({ success: false, reason: "no_token" });
  });

  it("maps a non-2xx subscribe to subscribe_failed_<status>", async () => {
    setModules({ expoNotifications: expo() });
    mockFetch([{ status: 403, body: { message: "Push subscriber limit reached" } }]);
    const c = client();
    expect(await c.register()).toEqual({ success: false, reason: "subscribe_failed_403" });
    expect(await c.getToken()).toBeNull();
  });

  it("maps fetch rejection to network_error", async () => {
    setModules({ expoNotifications: expo() });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Network request failed"))));
    expect(await client().register()).toEqual({ success: false, reason: "network_error" });
  });

  it("maps a slow subscribe to timed_out", async () => {
    setModules({ expoNotifications: expo() });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      ),
    );
    expect(await client({ timeoutMs: 20 }).register()).toEqual({ success: false, reason: "timed_out" });
  });

  it("times out even when fetch ignores the abort signal", async () => {
    setModules({ expoNotifications: expo() });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    expect(await client({ timeoutMs: 20 }).register()).toEqual({ success: false, reason: "timed_out" });
  });

  it("shares one in-flight register between concurrent callers", async () => {
    setModules({ expoNotifications: expo() });
    const m = mockFetch();
    const c = client();
    const [a, b] = await Promise.all([c.register(), c.register()]);
    expect(a).toEqual(b);
    expect(m.fn).toHaveBeenCalledTimes(1);
  });

  it("uses the default api url", async () => {
    setModules({ expoNotifications: expo() });
    const m = mockFetch();
    const c = new ReachBellClient();
    c.init({ apiKey: "rb_live_x" });
    await c.register();
    expect(m.calls[0].url).toBe("https://api.reachbell.com/subscribers");
  });
});

describe("identify / tag / untag", () => {
  it("returns no_subscription before register", async () => {
    const m = mockFetch();
    const c = client();
    expect(await c.identify("user_42")).toEqual({ ok: false, reason: "no_subscription" });
    expect(await c.tag(["pro"])).toEqual({ ok: false, reason: "no_subscription" });
    expect(await c.untag(["pro"])).toEqual({ ok: false, reason: "no_subscription" });
    expect(m.fn).not.toHaveBeenCalled();
  });

  async function registered(responses: Array<{ status?: number; body?: unknown }>) {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch([{ body: { _id: "s1" } }, ...responses]);
    const c = client();
    await c.register();
    return { c, m };
  }

  it("identifies with the stored token", async () => {
    const { c, m } = await registered([{ body: { success: true, updated: true } }]);
    expect(await c.identify("user_42")).toEqual({ ok: true, updated: true });
    expect(m.calls[1].url).toBe("https://api.test/subscribers/identify");
    expect(json(m.calls[1])).toEqual({ token: "tok-1", externalId: "user_42" });
  });

  it("tags and untags", async () => {
    const { c, m } = await registered([{ body: { success: true, updated: true } }, { body: { success: true, updated: false } }]);
    expect(await c.tag(["pro", "beta"])).toEqual({ ok: true, updated: true });
    expect(await c.untag("beta")).toEqual({ ok: true, updated: false });
    expect(m.calls.map((x) => new URL(x.url).pathname)).toEqual(["/subscribers", "/subscribers/tag", "/subscribers/untag"]);
    expect(json(m.calls[1])).toEqual({ token: "tok-1", tags: ["pro", "beta"] });
    expect(json(m.calls[2])).toEqual({ token: "tok-1", tags: ["beta"] });
  });

  it("maps 2xx success:false to ok:false with the server reason", async () => {
    const { c } = await registered([{ body: { success: false, updated: false, reason: "subscriber_not_found" } }]);
    expect(await c.tag(["pro"])).toEqual({ ok: false, reason: "subscriber_not_found" });
  });

  it("maps non-2xx to server_<status>", async () => {
    const { c } = await registered([{ status: 401, body: { message: "Invalid API key" } }]);
    expect(await c.identify("u")).toEqual({ ok: false, reason: "server_401" });
  });

  it("maps a 500 with a non-JSON body to server_500", async () => {
    const { c } = await registered([{ status: 500, body: "Internal Server Error" }]);
    expect(await c.untag(["x"])).toEqual({ ok: false, reason: "server_500" });
  });

  it("maps network failure to network_error", async () => {
    const { c } = await registered([]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Network request failed"))));
    expect(await c.identify("u")).toEqual({ ok: false, reason: "network_error" });
  });

  it("maps identify timeout to timed_out", async () => {
    const storage = memoryStorage();
    storage.data.set("reachbell:token:rb_live_test", "persisted");
    setModules({ asyncStorage: storage });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    expect(await client({ timeoutMs: 20 }).identify("u")).toEqual({ ok: false, reason: "timed_out" });
  });
});

describe("persistence", () => {
  it("reads a token persisted by a previous session", async () => {
    const storage = memoryStorage();
    storage.data.set("reachbell:token:rb_live_test", "from-disk");
    setModules({ asyncStorage: storage });
    const m = mockFetch([{ body: { success: true, updated: true } }]);
    const c = client();
    expect(await c.getToken()).toBe("from-disk");
    expect(await c.tag(["a"])).toEqual({ ok: true, updated: true });
    expect(json(m.calls[0]).token).toBe("from-disk");
  });

  it("falls back to memory when AsyncStorage is missing or broken", async () => {
    const broken = {
      getItem: vi.fn(async () => {
        throw new Error("native module null");
      }),
      setItem: vi.fn(async () => {
        throw new Error("native module null");
      }),
      removeItem: vi.fn(async () => {
        throw new Error("native module null");
      }),
    };
    setModules({ expoNotifications: expo({ data: "mem-tok" }), asyncStorage: broken });
    mockFetch();
    const c = client();
    expect((await c.register()).success).toBe(true);
    expect(await c.getToken()).toBe("mem-tok");
  });

  it("unregister and reset clear the stored token", async () => {
    const storage = memoryStorage();
    setModules({ expoNotifications: expo({ data: "t" }), asyncStorage: storage });
    mockFetch();
    const c = client();
    await c.register();
    expect(await c.getToken()).toBe("t");
    expect(await c.unregister()).toEqual({ ok: true });
    expect(await c.getToken()).toBeNull();
    expect(storage.data.has("reachbell:token:rb_live_test")).toBe(false);
    expect(await c.identify("u")).toEqual({ ok: false, reason: "no_subscription" });
    await c.register();
    expect(await c.reset()).toEqual({ ok: true });
    expect(await c.getToken()).toBeNull();
  });
});

describe("token rotation", () => {
  it("sends the stored token as previousToken when the token changed", async () => {
    const storage = memoryStorage();
    storage.data.set("reachbell:token:rb_live_test", "old-tok");
    setModules({ expoNotifications: expo({ data: "new-tok" }), asyncStorage: storage });
    const m = mockFetch();

    expect((await client().register()).success).toBe(true);

    expect(json(m.calls[0])).toMatchObject({ token: "new-tok", previousToken: "old-tok" });
    expect(storage.data.get("reachbell:token:rb_live_test")).toBe("new-tok");
  });

  it("omits previousToken on first registration and when the token is unchanged", async () => {
    setModules({ expoNotifications: expo({ data: "same-tok" }) });
    const m = mockFetch();
    const c = client();

    await c.register();
    await c.register();

    expect(json(m.calls[0]).previousToken).toBeUndefined();
    expect(json(m.calls[1]).previousToken).toBeUndefined();
  });
});

describe("reset / logout", () => {
  it("unidentifies the stored token before clearing it", async () => {
    const storage = memoryStorage();
    setModules({ expoNotifications: expo({ data: "tok-1" }), asyncStorage: storage });
    const m = mockFetch([{ body: { _id: "s1" } }, { body: { success: true } }]);
    const c = client();
    await c.register("user_42");

    expect(await c.reset()).toEqual({ ok: true });

    expect(m.calls[1].url).toBe("https://api.test/subscribers/unidentify");
    expect(json(m.calls[1])).toEqual({ token: "tok-1" });
    expect(header(m.calls[1], "x-api-key")).toBe("rb_live_test");
    expect(await c.getToken()).toBeNull();
    expect(storage.data.has("reachbell:token:rb_live_test")).toBe(false);
  });

  it("clears local state even when unidentify fails", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    mockFetch();
    const c = client();
    await c.register();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Network request failed"))));

    expect(await c.unregister()).toEqual({ ok: true });
    expect(await c.getToken()).toBeNull();
  });

  it("sends nothing when there is no stored token or no init", async () => {
    const m = mockFetch();
    expect(await new ReachBellClient().reset()).toEqual({ ok: true });
    expect(await client().reset()).toEqual({ ok: true });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("waits for an in-flight register, and later calls wait for the reset", async () => {
    // The token rotates between the two registrations, so previousToken would
    // be sent if the second register ran before the reset cleared the store.
    const ex = expo({ data: "tok-2" });
    ex.getDevicePushTokenAsync.mockResolvedValueOnce({ type: "ios", data: "tok-1" });
    setModules({ expoNotifications: ex });
    const m = mockFetch([{ body: { _id: "s1" } }, { body: { success: true } }, { body: { _id: "s2" } }, { body: { success: true } }]);
    const c = client();

    const first = c.register("user_42");
    const resetting = c.reset();
    const second = c.register("user_9");
    await Promise.all([first, resetting, second]);
    expect(await c.tag(["new_user"])).toMatchObject({ ok: true });

    expect(m.calls.map((x) => new URL(x.url).pathname)).toEqual([
      "/subscribers",
      "/subscribers/unidentify",
      "/subscribers",
      "/subscribers/tag",
    ]);
    expect(json(m.calls[1])).toEqual({ token: "tok-1" });
    expect(json(m.calls[2])).toMatchObject({ token: "tok-2", externalId: "user_9" });
    expect(json(m.calls[2]).previousToken).toBeUndefined();
    expect(json(m.calls[3]).token).toBe("tok-2");
    expect(await c.getToken()).toBe("tok-2");
  });

  it("settles reset -> register -> reset and later calls still run", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch([{ body: { _id: "s1" } }, { body: { success: true } }, { body: { _id: "s2" } }, { body: { success: true } }]);
    const c = client();
    await c.register();

    const settled = await Promise.all([c.reset(), c.register(), c.reset()]);
    expect(settled).toEqual([{ ok: true }, expect.objectContaining({ success: true, token: "tok-1" }), { ok: true }]);
    expect(await c.tag(["x"])).toEqual({ ok: false, reason: "no_subscription" });
    expect((await c.register()).success).toBe(true);
    expect(await c.tag(["x"])).toMatchObject({ ok: true });

    expect(m.calls.map((x) => new URL(x.url).pathname)).toEqual([
      "/subscribers",
      "/subscribers/unidentify",
      "/subscribers",
      "/subscribers/unidentify",
      "/subscribers",
      "/subscribers/tag",
    ]);
  });

  it("sends externalId: null on the first register after reset, persisted across restarts", async () => {
    const storage = memoryStorage();
    setModules({ expoNotifications: expo({ data: "tok-1" }), asyncStorage: storage });
    // Unidentify fails (offline), so only the null externalId can unlink the user.
    const m = mockFetch([{ body: { _id: "s1" } }, { status: 503 }, { body: { _id: "s1" } }, { body: { _id: "s1" } }]);
    const c = client();
    await c.register("user_42");
    await c.reset();
    expect(storage.data.get("reachbell:clear_external_id:rb_live_test")).toBe("1");

    // A fresh client (app restart) still sees the pending clear.
    const restarted = client();
    expect((await restarted.register()).success).toBe(true);
    expect(json(m.calls[2])).toHaveProperty("externalId", null);
    expect(storage.data.has("reachbell:clear_external_id:rb_live_test")).toBe(false);

    await restarted.register();
    expect(json(m.calls[3])).not.toHaveProperty("externalId");
  });

  it("keeps the clear pending when the register after reset fails", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch([{ status: 500 }, { body: { _id: "s1" } }]);
    const c = client();
    await c.reset();
    expect((await c.register()).success).toBe(false);
    expect((await c.register()).success).toBe(true);
    expect(json(m.calls[0])).toHaveProperty("externalId", null);
    expect(json(m.calls[1])).toHaveProperty("externalId", null);
  });

  it("sends the caller's externalId instead of null after reset", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch();
    const c = client();
    await c.reset();
    await c.register("user_7");
    expect(json(m.calls[0])).toMatchObject({ externalId: "user_7" });
  });
});

describe("concurrent register", () => {
  it("links the newest externalId when register(id) is called during a pending register", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch([{ body: { _id: "s1" } }, { body: { _id: "s1" } }]);
    const c = client();

    const first = c.register("u1");
    const second = c.register("u2");
    const third = c.register();
    expect(third).toBe(second);
    const [a, b] = await Promise.all([first, second]);

    expect(a.success && b.success).toBe(true);
    expect(m.calls.map((x) => json(x).externalId)).toEqual(["u1", "u2"]);
  });

  it("joins a pending register with the same externalId", async () => {
    setModules({ expoNotifications: expo({ data: "tok-1" }) });
    const m = mockFetch();
    const c = client();
    const first = c.register("u1");
    expect(c.register("u1")).toBe(first);
    expect(c.register()).toBe(first);
    await first;
    expect(m.fn).toHaveBeenCalledTimes(1);
  });
});

describe("device info", () => {
  it("sends the Android release string as osVersion and detects tablets by shortest side", async () => {
    const rn = {
      ...reactNative("android", 34),
      Platform: { OS: "android", Version: 34, constants: { Release: "14" } },
      Dimensions: { get: () => ({ width: 800, height: 1280 }) },
    };
    setModules({ reactNative: rn, firebaseMessaging: firebaseNamespaced().mod });
    const m = mockFetch();
    await client().register();
    expect(json(m.calls[0])).toMatchObject({ os: "Android", osVersion: "14", device: "tablet" });
  });

  it("falls back to Platform.Version and mobile", async () => {
    setModules({ reactNative: reactNative("android", 34), firebaseMessaging: firebaseNamespaced().mod });
    const m = mockFetch();
    await client().register();
    expect(json(m.calls[0])).toMatchObject({ osVersion: "34", device: "mobile" });
  });

  it("reports an iPad as a tablet", async () => {
    const rn = { ...reactNative("ios"), Platform: { OS: "ios", Version: "17.4", isPad: true } };
    setModules({ reactNative: rn, expoNotifications: expo() });
    const m = mockFetch();
    await client().register();
    expect(json(m.calls[0])).toMatchObject({ os: "iOS", osVersion: "17.4", device: "tablet" });
  });
});

describe("module api", () => {
  it("exposes the documented functions on the namespace and default export", async () => {
    for (const name of ["init", "register", "identify", "tag", "untag", "getToken", "unregister", "reset"] as const) {
      expect(typeof ReachBell[name]).toBe("function");
      expect(typeof ReachBell.default[name]).toBe("function");
    }
    expect(ReachBell.SDK_VERSION).toBe("2.0.0");
    setModules({ expoNotifications: expo({ data: "ns-tok" }) });
    mockFetch();
    ReachBell.init({ apiKey: "rb_live_ns" });
    expect(await ReachBell.register()).toMatchObject({ success: true, token: "ns-tok" });
    expect(await ReachBell.getToken()).toBe("ns-tok");
  });
});
