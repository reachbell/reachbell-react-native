export interface InitOptions {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  debug?: boolean;
}

export type TokenType = "fcm" | "apns";

export type DevicePlatform = "android" | "ios";

export type PushBackendName = "expo" | "firebase";

export type RegisterReason =
  | "sdk_not_initialized"
  | "unsupported_platform"
  | "no_push_module"
  | "permission_denied"
  | "no_token"
  | `subscribe_failed_${number}`
  | "timed_out"
  | "network_error";

export interface RegisterResult {
  success: boolean;
  token?: string;
  tokenType?: TokenType;
  subscriberId?: string;
  reason?: RegisterReason;
}

export type ActionReason =
  | "sdk_not_initialized"
  | "no_subscription"
  | `server_${number}`
  | "timed_out"
  | "network_error"
  | (string & {});

export interface ActionResult {
  ok: boolean;
  updated?: boolean;
  reason?: ActionReason;
}

export interface ResetResult {
  ok: true;
}

export interface PushToken {
  token: string;
  tokenType: TokenType;
}

export type PushTokenOutcome =
  | { ok: true; value: PushToken }
  | { ok: false; reason: "permission_denied" | "no_token" };

export interface PushBackend {
  name: PushBackendName;
  acquire(platform: DevicePlatform): Promise<PushTokenOutcome>;
}

export interface ExpoPermissionResponse {
  granted?: boolean;
  status?: string;
  ios?: { status?: number };
}

export interface ExpoNotificationsModule {
  getPermissionsAsync(): Promise<ExpoPermissionResponse>;
  requestPermissionsAsync(options?: unknown): Promise<ExpoPermissionResponse>;
  getDevicePushTokenAsync(): Promise<{ type: string; data: unknown }>;
  getNotificationChannelsAsync?: () => Promise<unknown[] | null>;
  setNotificationChannelAsync?: (id: string, channel: Record<string, unknown>) => Promise<unknown>;
  AndroidImportance?: Record<string, number>;
}

export interface FirebaseMessagingInstance {
  requestPermission(options?: unknown): Promise<number>;
  getToken(): Promise<string>;
  registerDeviceForRemoteMessages?: () => Promise<void>;
  isDeviceRegisteredForRemoteMessages?: boolean;
}

export interface FirebaseMessagingModule {
  default?: () => FirebaseMessagingInstance;
  getMessaging?: () => unknown;
  requestPermission?: (messaging: unknown, options?: unknown) => Promise<number>;
  getToken?: (messaging: unknown) => Promise<string>;
  registerDeviceForRemoteMessages?: (messaging: unknown) => Promise<void>;
  isDeviceRegisteredForRemoteMessages?: (messaging: unknown) => boolean;
}

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ReactNativeModule {
  Platform: {
    OS: string;
    Version: number | string;
    /** iOS only. */
    isPad?: boolean;
    /** Android: `Release` is the OS version string ("14"); `Version` is the API level. */
    constants?: { Release?: string };
  };
  Dimensions?: { get(dim: "screen" | "window"): { width: number; height: number } };
  PermissionsAndroid?: {
    request(permission: string): Promise<string>;
    PERMISSIONS?: Record<string, string>;
    RESULTS?: Record<string, string>;
  };
}

export interface OptionalModules {
  reactNative: ReactNativeModule | null;
  expoNotifications: ExpoNotificationsModule | null;
  firebaseMessaging: FirebaseMessagingModule | (() => FirebaseMessagingInstance) | null;
  asyncStorage: AsyncStorageLike | null;
}

export interface ClientConfig {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
  debug: boolean;
}

export type HttpOutcome =
  | { kind: "response"; status: number; ok: boolean; body: unknown }
  | { kind: "timeout" }
  | { kind: "network" };
