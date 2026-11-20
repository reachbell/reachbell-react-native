import { ReachBellClient } from "./client";
import type { ActionResult, InitOptions, RegisterResult, ResetResult } from "./types";

const client = new ReachBellClient();

export function init(options: InitOptions): void {
  client.init(options);
}

export function register(externalId?: string): Promise<RegisterResult> {
  return client.register(externalId);
}

export function identify(externalId: string): Promise<ActionResult> {
  return client.identify(externalId);
}

export function tag(tags: string[] | string): Promise<ActionResult> {
  return client.tag(tags);
}

export function untag(tags: string[] | string): Promise<ActionResult> {
  return client.untag(tags);
}

export function getToken(): Promise<string | null> {
  return client.getToken();
}

export function unregister(): Promise<ResetResult> {
  return client.unregister();
}

export function reset(): Promise<ResetResult> {
  return client.reset();
}

export { SDK_VERSION } from "./constants";
export type {
  ActionReason,
  ActionResult,
  DevicePlatform,
  InitOptions,
  PushBackendName,
  RegisterReason,
  RegisterResult,
  ResetResult,
  TokenType,
} from "./types";

const ReachBell = { init, register, identify, tag, untag, getToken, unregister, reset };

export default ReachBell;
