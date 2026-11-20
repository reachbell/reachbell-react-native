import type {
  AsyncStorageLike,
  ExpoNotificationsModule,
  FirebaseMessagingModule,
  OptionalModules,
  ReactNativeModule,
} from "../types";
import { interopDefault } from "../utils";

declare const require: (id: string) => unknown;

function loadReactNative(): ReactNativeModule | null {
  try {
    return require("react-native") as ReactNativeModule;
  } catch {
    return null;
  }
}

function loadExpoNotifications(): ExpoNotificationsModule | null {
  try {
    return require("expo-notifications") as ExpoNotificationsModule;
  } catch {
    return null;
  }
}

function loadFirebaseMessaging(): FirebaseMessagingModule | null {
  try {
    return require("@react-native-firebase/messaging") as FirebaseMessagingModule;
  } catch {
    return null;
  }
}

function loadAsyncStorage(): AsyncStorageLike | null {
  try {
    return interopDefault<AsyncStorageLike>(require("@react-native-async-storage/async-storage"));
  } catch {
    return null;
  }
}

export function loadModules(): OptionalModules {
  return {
    reactNative: loadReactNative(),
    expoNotifications: loadExpoNotifications(),
    firebaseMessaging: loadFirebaseMessaging(),
    asyncStorage: loadAsyncStorage(),
  };
}
