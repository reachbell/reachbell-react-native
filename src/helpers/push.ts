import {
  ANDROID_NOTIFICATIONS_API_LEVEL,
  ANDROID_POST_NOTIFICATIONS,
  EXPO_DEFAULT_CHANNEL_ID,
  EXPO_DEFAULT_IMPORTANCE,
  EXPO_IOS_PROVISIONAL,
  FIREBASE_AUTHORIZED_MIN,
} from "../constants";
import type {
  DevicePlatform,
  ExpoNotificationsModule,
  ExpoPermissionResponse,
  FirebaseMessagingInstance,
  FirebaseMessagingModule,
  OptionalModules,
  PushBackend,
  PushTokenOutcome,
  ReactNativeModule,
} from "../types";
import { toNumber } from "../utils";

interface FirebaseApi {
  requestPermission(): Promise<number>;
  getToken(): Promise<string>;
  ensureRegistered(): Promise<void>;
}

const NO_TOKEN: PushTokenOutcome = { ok: false, reason: "no_token" };
const DENIED: PushTokenOutcome = { ok: false, reason: "permission_denied" };

function isExpoUsable(mod: ExpoNotificationsModule | null): mod is ExpoNotificationsModule {
  return (
    !!mod &&
    typeof mod.getDevicePushTokenAsync === "function" &&
    typeof mod.getPermissionsAsync === "function" &&
    typeof mod.requestPermissionsAsync === "function"
  );
}

function expoGranted(res: ExpoPermissionResponse | null | undefined): boolean {
  if (!res) return false;
  if (res.granted === true || res.status === "granted") return true;
  return res.ios?.status === EXPO_IOS_PROVISIONAL;
}

async function ensureExpoChannel(mod: ExpoNotificationsModule): Promise<void> {
  if (typeof mod.setNotificationChannelAsync !== "function") return;
  try {
    const channels = typeof mod.getNotificationChannelsAsync === "function" ? await mod.getNotificationChannelsAsync() : null;
    if (Array.isArray(channels) && channels.length > 0) return;
    await mod.setNotificationChannelAsync(EXPO_DEFAULT_CHANNEL_ID, {
      name: "Default",
      importance: mod.AndroidImportance?.DEFAULT ?? EXPO_DEFAULT_IMPORTANCE,
    });
  } catch {
    return;
  }
}

function expoBackend(mod: ExpoNotificationsModule): PushBackend {
  return {
    name: "expo",
    async acquire(platform: DevicePlatform): Promise<PushTokenOutcome> {
      if (platform === "android") await ensureExpoChannel(mod);
      let permission: ExpoPermissionResponse;
      try {
        permission = await mod.getPermissionsAsync();
        if (!expoGranted(permission)) permission = await mod.requestPermissionsAsync();
      } catch {
        return DENIED;
      }
      if (!expoGranted(permission)) return DENIED;
      try {
        const device = await mod.getDevicePushTokenAsync();
        const token = typeof device?.data === "string" ? device.data : "";
        if (!token) return NO_TOKEN;
        return { ok: true, value: { token, tokenType: platform === "ios" ? "apns" : "fcm" } };
      } catch {
        return NO_TOKEN;
      }
    },
  };
}

function firebaseApi(mod: FirebaseMessagingModule | (() => FirebaseMessagingInstance)): FirebaseApi | null {
  if (typeof mod !== "function") {
    const { getMessaging, requestPermission, getToken, registerDeviceForRemoteMessages, isDeviceRegisteredForRemoteMessages } = mod;
    if (typeof getMessaging === "function" && typeof requestPermission === "function" && typeof getToken === "function") {
      const instance = getMessaging();
      return {
        requestPermission: () => requestPermission(instance),
        getToken: () => getToken(instance),
        async ensureRegistered() {
          if (typeof registerDeviceForRemoteMessages !== "function") return;
          if (typeof isDeviceRegisteredForRemoteMessages === "function" && isDeviceRegisteredForRemoteMessages(instance)) return;
          await registerDeviceForRemoteMessages(instance);
        },
      };
    }
  }
  const factory = typeof mod === "function" ? mod : typeof mod.default === "function" ? mod.default : null;
  if (!factory) return null;
  const instance = factory();
  if (!instance || typeof instance.getToken !== "function") return null;
  return {
    requestPermission: () => instance.requestPermission(),
    getToken: () => instance.getToken(),
    async ensureRegistered() {
      if (typeof instance.registerDeviceForRemoteMessages !== "function") return;
      if (instance.isDeviceRegisteredForRemoteMessages === true) return;
      await instance.registerDeviceForRemoteMessages();
    },
  };
}

function isFirebaseUsable(mod: OptionalModules["firebaseMessaging"]): mod is NonNullable<OptionalModules["firebaseMessaging"]> {
  if (!mod) return false;
  if (typeof mod === "function") return true;
  return typeof mod.default === "function" || typeof mod.getMessaging === "function";
}

async function androidNotificationPermission(rn: ReactNativeModule | null): Promise<boolean> {
  if (!rn || toNumber(rn.Platform.Version) < ANDROID_NOTIFICATIONS_API_LEVEL) return true;
  const permissions = rn.PermissionsAndroid;
  if (!permissions || typeof permissions.request !== "function") return true;
  try {
    const permission = permissions.PERMISSIONS?.POST_NOTIFICATIONS ?? ANDROID_POST_NOTIFICATIONS;
    const result = await permissions.request(permission);
    return result === (permissions.RESULTS?.GRANTED ?? "granted");
  } catch {
    return false;
  }
}

function firebaseBackend(mod: NonNullable<OptionalModules["firebaseMessaging"]>, rn: ReactNativeModule | null): PushBackend {
  return {
    name: "firebase",
    async acquire(platform: DevicePlatform): Promise<PushTokenOutcome> {
      let api: FirebaseApi | null;
      try {
        api = firebaseApi(mod);
      } catch {
        return NO_TOKEN;
      }
      if (!api) return NO_TOKEN;
      if (platform === "android") {
        if (!(await androidNotificationPermission(rn))) return DENIED;
      } else {
        try {
          const status = await api.requestPermission();
          if (toNumber(status) < FIREBASE_AUTHORIZED_MIN) return DENIED;
        } catch {
          return DENIED;
        }
        try {
          await api.ensureRegistered();
        } catch {
          return NO_TOKEN;
        }
      }
      try {
        const token = await api.getToken();
        if (typeof token !== "string" || !token) return NO_TOKEN;
        return { ok: true, value: { token, tokenType: "fcm" } };
      } catch {
        return NO_TOKEN;
      }
    },
  };
}

/**
 * backend.acquire() bounded by timeoutMs. A permission prompt or token fetch
 * that never settles resolves { ok: false, reason: "token_timeout" }, so the
 * register queue moves on; the abandoned call's late result is ignored.
 */
export function acquireWithTimeout(
  backend: PushBackend,
  platform: DevicePlatform,
  timeoutMs: number,
): Promise<PushTokenOutcome | { ok: false; reason: "token_timeout" }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: "token_timeout" }), timeoutMs);
    const done = (outcome: PushTokenOutcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    let pending: Promise<PushTokenOutcome>;
    try {
      pending = backend.acquire(platform);
    } catch {
      done(NO_TOKEN);
      return;
    }
    pending.then(done, () => done(NO_TOKEN));
  });
}

export function detectBackend(modules: OptionalModules): PushBackend | null {
  if (isFirebaseUsable(modules.firebaseMessaging)) return firebaseBackend(modules.firebaseMessaging, modules.reactNative);
  if (isExpoUsable(modules.expoNotifications)) return expoBackend(modules.expoNotifications);
  return null;
}

export function devicePlatform(rn: ReactNativeModule | null): DevicePlatform | null {
  const os = rn?.Platform?.OS;
  return os === "android" || os === "ios" ? os : null;
}
