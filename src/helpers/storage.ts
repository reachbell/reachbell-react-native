import type { AsyncStorageLike } from "../types";

export class TokenStore {
  private readonly memory = new Map<string, string>();

  constructor(private readonly backing: AsyncStorageLike | null) {}

  get persistent(): boolean {
    return !!this.backing;
  }

  async get(key: string): Promise<string | null> {
    const cached = this.memory.get(key);
    if (cached !== undefined) return cached;
    if (!this.backing) return null;
    try {
      const value = await this.backing.getItem(key);
      if (typeof value === "string" && value) {
        this.memory.set(key, value);
        return value;
      }
    } catch {
      return null;
    }
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    this.memory.set(key, value);
    if (!this.backing) return;
    try {
      await this.backing.setItem(key, value);
    } catch {
      return;
    }
  }

  async remove(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.backing) return;
    try {
      await this.backing.removeItem(key);
    } catch {
      return;
    }
  }
}
