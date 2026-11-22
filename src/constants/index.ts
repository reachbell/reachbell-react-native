export const SDK_VERSION = "2.0.0";
export const DEFAULT_API_URL = "https://api.reachbell.com";
export const DEFAULT_TIMEOUT_MS = 15000;
/** Permission prompt + push token acquisition, matching Android's tokenFetchTimeoutMs. */
export const DEFAULT_TOKEN_TIMEOUT_MS = 30000;
export const PUBLIC_KEY_PREFIX = "rb_live_";
export const SECRET_KEY_PREFIX = "rb_secret_";
export const STORAGE_KEY_PREFIX = "reachbell:token:";
export const CLEAR_EXTERNAL_ID_KEY_PREFIX = "reachbell:clear_external_id:";
/** Android counts a device whose shortest side is at least 600dp as a tablet (sw600dp). */
export const TABLET_MIN_SHORTEST_SIDE_DP = 600;
export const LOG_PREFIX = "[ReachBell]";
export const ANDROID_POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
export const ANDROID_NOTIFICATIONS_API_LEVEL = 33;
export const EXPO_DEFAULT_CHANNEL_ID = "default";
export const EXPO_DEFAULT_IMPORTANCE = 3;
export const FIREBASE_AUTHORIZED_MIN = 1;
export const EXPO_IOS_PROVISIONAL = 3;
