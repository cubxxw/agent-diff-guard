import { test, expect, describe } from "bun:test";
import { adapterConfig, allAdapters, type SupportedAgent } from "./adapters";

const AGENTS: SupportedAgent[] = ["claude", "cursor", "codex", "copilot"];

describe("adapterConfig", () => {
  test("each agent returns a non-empty configSnippet", () => {
    for (const a of AGENTS) {
      const r = adapterConfig(a, "src/cli.ts");
      expect(r.agent).toBe(a);
      expect(r.configSnippet.length).toBeGreaterThan(0);
      expect(r.instructions.length).toBeGreaterThan(0);
    }
  });

  test("cursor snippet references .cursorrules", () => {
    const r = adapterConfig("cursor", "src/cli.ts");
    expect(r.configSnippet.toLowerCase()).toContain("cursorrules");
  });

  test("copilot snippet is a GitHub Actions workflow", () => {
    const r = adapterConfig("copilot", "src/cli.ts");
    const lower = r.configSnippet.toLowerCase();
    expect(lower).toContain("actions");
    expect(lower).toContain("pull_request");
  });

  test("claude snippet embeds the guard cli path", () => {
    const r = adapterConfig("claude", "my/custom/cli.ts");
    expect(r.configSnippet).toContain("my/custom/cli.ts");
  });

  test("codex snippet is non-empty and mentions codex", () => {
    const r = adapterConfig("codex", "src/cli.ts");
    expect(r.configSnippet.toLowerCase()).toContain("codex");
  });
});

describe("allAdapters", () => {
  test("returns all 4 supported agents", () => {
    const all = allAdapters("src/cli.ts");
    expect(Object.keys(all).sort()).toEqual([...AGENTS].sort());
    for (const a of AGENTS) {
      expect(all[a].agent).toBe(a);
    }
  });
});
