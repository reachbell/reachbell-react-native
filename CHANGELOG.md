# Changelog

## 2.0.0

### Breaking

- The package ships a single CommonJS build (`dist/index.cjs` with `dist/index.d.cts` types). The ESM `import` export condition, the `module` field and `dist/index.d.ts` are gone, so Metro always resolves the bundle whose `require()` calls for the optional push modules sit inside `try` blocks. `import ReachBell from "@reachbell/react-native"` and named imports keep working through the bundler and through Node's CommonJS interop.

### Added

- `reset()` / `unregister()` call `POST /subscribers/unidentify` for the stored token (best effort) before clearing it, so a logged-out user is unlinked on the server. They wait for a `register()` in flight, and `register()`, `identify()`, `tag()` and `untag()` called meanwhile wait for them.
- `register()` sends the stored token as `previousToken` when the push token changed. ReachBell moves the old subscriber's tags and external id to the new token and deactivates the old one.

### Changed

- `SDK_VERSION` is `2.0.0`.
- README: corrected the `allowOptionalDependencies` note. `@react-native/metro-config` and `expo/metro-config` turn it on; Metro's own default is version-dependent.

## 1.0.0

- Initial release.
