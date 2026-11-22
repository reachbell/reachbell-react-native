import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Metro only treats a dependency as optional (transformer.allowOptionalDependencies)
// when it sees a literal require("pkg") directly inside a try block. The README
// promises that, so check the published build keeps that shape.
// `npm test` builds first; this reads the fresh dist/.
const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dist = join(root, "dist");
const OPTIONAL = Object.keys(pkg.peerDependenciesMeta ?? {});

function publishedEntries(): string[] {
  const entries = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (/\.c?js$/.test(v)) entries.add(v);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk([pkg.main, pkg.module, pkg["react-native"], pkg.exports]);
  return [...entries];
}

describe("published build", () => {
  it("lists every optional peer dependency", () => {
    expect(OPTIONAL).toEqual(
      expect.arrayContaining(["expo-notifications", "@react-native-firebase/messaging", "@react-native-async-storage/async-storage"]),
    );
  });

  it("ships only the CommonJS bundle", () => {
    const code = readdirSync(dist).filter((f) => /\.(c|m)?js$/.test(f));
    expect(code).toEqual(["index.cjs"]);
    expect(publishedEntries().map((e) => e.replace(/^\.\//, ""))).toEqual(["dist/index.cjs"]);
  });

  for (const entry of publishedEntries()) {
    const source = readFileSync(join(root, entry), "utf8");

    it(`${entry} has no __require shim`, () => {
      expect(source).not.toMatch(/__require\(/);
    });

    it(`${entry} lists its exports for Node's ESM named imports`, () => {
      expect(source).toMatch(/0 && \(module\.exports = \{[^}]*\binit\b[^}]*\bregister\b/);
    });

    for (const name of OPTIONAL) {
      it(`${entry} requires ${name} directly inside a try block`, () => {
        const literal = `require(${JSON.stringify(name)})`;
        const at = source.indexOf(literal);
        expect(at, `${literal} not found`).toBeGreaterThan(-1);
        // The nearest enclosing statement before the call must be `try {` within the same function.
        const before = source.slice(Math.max(0, at - 200), at);
        expect(before).toMatch(/try\s*\{\s*return\s+(?:\w+\()?$/);
      });
    }
  }
});
