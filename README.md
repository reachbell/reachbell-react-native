# @reachbell/react-native

React Native client SDK for [ReachBell](https://reachbell.com), for both Expo and bare React Native apps. It asks for notification permission, acquires the device's native push token (FCM on Android, APNs or FCM on iOS), registers it with ReachBell, and links the device to your users with `identify` and `tag`.

To send messages to these devices from your backend, use [`@reachbell/node`](https://docs.reachbell.com/server/node).

## Install

```bash
npm install @reachbell/react-native
```

Then install the token backend your app uses, plus AsyncStorage (recommended):

```bash
npx expo install expo-notifications @react-native-async-storage/async-storage

npm install @react-native-firebase/app @react-native-firebase/messaging @react-native-async-storage/async-storage
cd ios && pod install
```

The first line is for Expo apps, the second for bare React Native apps.

The SDK detects the installed backend at runtime. Both are optional peer dependencies; install the one that matches your app. If both are installed, `@react-native-firebase/messaging` is used.

The registered token is persisted with `@react-native-async-storage/async-storage` when it is installed, so `identify()` and `tag()` keep working across app restarts. Without it, an in-memory copy covers the current session.

### Bundler (Metro)

The SDK loads `expo-notifications`, `@react-native-firebase/messaging` and `@react-native-async-storage/async-storage` with `require()` inside `try`/`catch`, so you only install the ones you use. Metro treats those as optional through `transformer.allowOptionalDependencies`, which current versions of Metro, `@react-native/metro-config` and `expo/metro-config` all turn on.

If the bundle fails with "Unable to resolve module" for one of those three packages and you didn't install it, the usual cause is that your Metro config has turned the option off (or uses an older Metro). Turn it back on, after any other config so nothing overrides it:

```js
// metro.config.js (bare React Native)
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

module.exports = mergeConfig(getDefaultConfig(__dirname), /* your config, */ {
  transformer: { allowOptionalDependencies: true },
});
```

```js
// metro.config.js (Expo)
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.transformer.allowOptionalDependencies = true;
module.exports = config;
```

If the option is on and the error remains:

- **A custom `resolver.resolveRequest`** (common in monorepos and SVG or alias setups) must hand anything it doesn't handle back to `context.resolveRequest(context, moduleName, platform)`. Throwing its own error for an unknown module stops Metro from treating the package as optional.
- **`register()` resolves `no_push_module` although the package is installed.** Metro didn't bundle it. Check that the package is listed in your app's own `package.json` (not only a workspace root that Metro doesn't watch), then restart Metro with `--reset-cache`.

## Setup

Native push credentials are required on both platforms.

### Expo

1. Use a development build or a production build. Remote push tokens are not available in Expo Go.
2. Android (FCM): add your FCM credentials with `eas credentials` and reference `google-services.json` from `expo.android.googleServicesFile` in `app.json`.
3. iOS (APNs): run `eas credentials` to create or upload an APNs key; EAS enables the Push Notifications capability when building.
4. Optionally set a foreground notification handler:

```ts
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

The SDK uses `getDevicePushTokenAsync()` (the raw FCM or APNs token), not `getExpoPushTokenAsync()`. On iOS this registers an APNs token (`tokenType: "apns"`), on Android an FCM token (`tokenType: "fcm"`). On Android, if the app has no notification channel yet, a `default` channel is created so the Android 13+ permission prompt can appear.

### Bare React Native

1. Install `@react-native-firebase/app`, `@react-native-firebase/messaging` and AsyncStorage, then `cd ios && pod install`.
2. Android: add `google-services.json` to `android/app/` and apply the Google Services Gradle plugin. On Android 13+ `register()` requests the `POST_NOTIFICATIONS` runtime permission.
3. iOS: add `GoogleService-Info.plist`, enable Push Notifications and Background Modes > Remote notifications, and upload your APNs key to the Firebase console.

With this backend the FCM token is registered on both platforms (`tokenType: "fcm"`).

## Usage

```ts
import * as ReachBell from "@reachbell/react-native";

ReachBell.init({ apiKey: "rb_live_..." });

const r = await ReachBell.register();
if (r.success) console.log("registered token:", r.token);
else console.warn("register failed:", r.reason);

await ReachBell.identify("user_42");
await ReachBell.tag(["pro", "beta"]);
await ReachBell.untag(["beta"]);

const token = await ReachBell.getToken();

await ReachBell.reset();
```

Use the public key (`rb_live_...`) for your project. Never ship the secret key in an app.

| Function | Description |
|---|---|
| `init({ apiKey, apiUrl?, timeoutMs?, debug? })` | Configure the SDK. `apiUrl` defaults to `https://api.reachbell.com`, `timeoutMs` to 15000. `debug` logs to the console. |
| `register(externalId?)` | Request permission, acquire the token, `POST /subscribers`. Passing `externalId` binds the user in the same call. |
| `identify(externalId)` | `POST /subscribers/identify` with the stored token. |
| `tag(tags)` | `POST /subscribers/tag` with the stored token. |
| `untag(tags)` | `POST /subscribers/untag` with the stored token. |
| `getToken()` | Resolves the stored device token, or `null` before registration. |
| `unregister()` / `reset()` | Clear the stored token on this device (for example on logout). The server subscription is not deleted. |

## Results

No function throws. Each resolves with a plain result object.

`register()` resolves `{ success, token?, tokenType?, subscriberId?, reason? }`. `reason` is one of:

```
sdk_not_initialized  unsupported_platform  no_push_module  permission_denied
no_token  subscribe_failed_<status>  timed_out  network_error
```

`no_push_module` means neither `expo-notifications` nor `@react-native-firebase/messaging` is installed. `subscribe_failed_403` means the plan's subscriber limit was reached.

`identify()`, `tag()` and `untag()` resolve `{ ok, updated?, reason? }`. `reason` is one of:

```
sdk_not_initialized  no_subscription  server_<status>  timed_out  network_error
```

or a reason returned by the API, such as `subscriber_not_found`. `no_subscription` means the device has not registered yet; call `register()` first.

Displaying and handling received notifications stays with your notification library: `Notifications.addNotificationReceivedListener` on Expo, `messaging().onMessage` and `messaging().setBackgroundMessageHandler` on bare React Native.

Full documentation: https://docs.reachbell.com/mobile/react-native

## License

MIT
