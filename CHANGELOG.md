# Changelog

## 2.0.0

### Breaking

- The package ships a single CommonJS build (`dist/index.cjs` with `dist/index.d.cts` types). The ESM `import` export condition, the `module` field and `dist/index.d.ts` are gone, so Metro always resolves the bundle whose `require()` calls for the optional push modules sit inside `try` blocks. `import ReachBell from "@reachbell/react-native"` and named imports keep working through the bundler and through Node's CommonJS interop.

### Added

- `reset()` / `unregister()` call `POST /subscribers/unidentify` for the stored token (best effort) before clearing it, so a logged-out user is unlinked on the server. They wait for a `register()` in flight, and `register()`, `identify()`, `tag()` and `untag()` called meanwhile wait for them.
- `register()` sends the stored token as `previousToken` when the push token changed. ReachBell moves the old subscriber's tags and external id to the new token and deactivates the old one.
- After `reset()` / `unregister()`, the next `register()` without an external id sends `externalId: null`, so the server unlinks the user even when the logout's unidentify call failed (for example offline). The pending clear is stored next to the token (a separate key in AsyncStorage when installed) and is dropped after a successful registration.
- `init({ tokenTimeoutMs })` (default 30000) bounds the permission prompt and push token fetch. When the push module does not answer in time, `register()` resolves `{ success: false, reason: "token_timeout" }` and the register/reset queue moves on.
- `register()` resolves `reason: "reinitialized"` when `init()` is called again while it runs. Each queued `register()` / `reset()` keeps the api key and storage keys it was queued with and drops its results after a re-init, so a registration for the old key can no longer write the new key's token.
- `register()` reports `device: "tablet"` for iPads and for Android devices whose shortest screen side is at least 600dp.

### Changed

- `SDK_VERSION` is `2.0.0`.
- On Android, `osVersion` is the OS release (for example `"14"`) from `Platform.constants.Release` instead of the API level; it falls back to `Platform.Version`.
- `register(externalId)` called while another `register()` is in flight with a different external id no longer drops the new id: it queues a second registration after the first, which links the newest id. Calls with no id or the same id still share the one in flight.

### Fixed

- `reset(); register(); reset();` no longer hangs. `register()` and `reset()` now run one at a time on a single queue in call order, and `identify()`, `tag()` and `untag()` wait only for the reset queued when they are called.
- README: documented that `tag()` / `identify()` called right after `reset(); register();` without awaiting `register()` can resolve `no_subscription`.
- README: corrected the `allowOptionalDependencies` note. `@react-native/metro-config` and `expo/metro-config` turn it on; Metro's own default is version-dependent.

## 1.0.0

- Initial release.
