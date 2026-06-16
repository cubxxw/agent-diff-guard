import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpHome: string;
const origAdgHome = process.env.ADG_HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "adg-projects-"));
  process.env.ADG_HOME = tmpHome;
});
afterEach(() => {
  if (origAdgHome === undefined) delete process.env.ADG_HOME;
  else process.env.ADG_HOME = origAdgHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

test("listProjects returns empty on fresh install", async () => {
  const { listProjects } = await import("./projects");
  expect(listProjects()).toEqual([]);
});

test("createProject and listProjects round-trip", async () => {
  const { createProject, listProjects } = await import("./projects");
  const p = createProject({ name: "test-repo", cwd: "/tmp/test-repo", nowMs: 1_700_000_000_000 });
  expect(p.name).toBe("test-repo");
  expect(p.cwd).toBe("/tmp/test-repo");
  expect(p.permissionMode).toBe("default");
  expect(p.favorite).toBe(false);
  expect(p.description).toBeUndefined();
  const all = listProjects();
  expect(all.length).toBe(1);
  expect(all[0]!.id).toBe(p.id);
});

test("createProject with all options", async () => {
  const { createProject } = await import("./projects");
  const p = createProject({
    name: "full",
    cwd: "/tmp/full",
    permissionMode: "bypassPermissions",
    favorite: true,
    description: "test desc",
    nowMs: 1_700_000_000_000,
  });
  expect(p.permissionMode).toBe("bypassPermissions");
  expect(p.favorite).toBe(true);
  expect(p.description).toBe("test desc");
});

test("getProject finds by id", async () => {
  const { createProject, getProject } = await import("./projects");
  const p = createProject({ name: "a", cwd: "/tmp/a" });
  expect(getProject(p.id)?.name).toBe("a");
  expect(getProject("nonexistent")).toBeUndefined();
});

test("updateProject changes fields and bumps updatedAt", async () => {
  const { createProject, updateProject } = await import("./projects");
  const p = createProject({ name: "a", cwd: "/tmp/a", nowMs: 1_700_000_000_000 });
  const updated = updateProject(p.id, { name: "b", favorite: true, permissionMode: "acceptEdits" }, 1_700_000_001_000);
  expect(updated).not.toBeNull();
  expect(updated!.name).toBe("b");
  expect(updated!.favorite).toBe(true);
  expect(updated!.permissionMode).toBe("acceptEdits");
  expect(updated!.cwd).toBe("/tmp/a");
  expect(updated!.updatedAt > p.updatedAt).toBe(true);
});

test("updateProject returns null for missing id", async () => {
  const { updateProject } = await import("./projects");
  expect(updateProject("nonexistent", { name: "x" })).toBeNull();
});

test("deleteProject removes and returns true; missing returns false", async () => {
  const { createProject, deleteProject, listProjects } = await import("./projects");
  const p = createProject({ name: "x", cwd: "/tmp/x" });
  expect(deleteProject(p.id)).toBe(true);
  expect(listProjects().length).toBe(0);
  expect(deleteProject("nonexistent")).toBe(false);
});

test("multiple projects coexist", async () => {
  const { createProject, listProjects } = await import("./projects");
  createProject({ name: "a", cwd: "/tmp/a", nowMs: 1_700_000_000_000 });
  createProject({ name: "b", cwd: "/tmp/b", nowMs: 1_700_000_001_000 });
  createProject({ name: "c", cwd: "/tmp/c", nowMs: 1_700_000_002_000 });
  expect(listProjects().length).toBe(3);
});
