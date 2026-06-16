// projects.ts — Project registration and management.
//
// Each project maps a name to a working directory + Claude permission level.
// The run daemon reads this at execution time to route inbox decisions
// to the right cwd with the right permission mode.
//
// Storage: single JSON file at ~/.agent-diff-guard/projects.json (bounded list).
// Why not one-file-per-item like inbox: projects are user-curated (5-30),
// not a high-throughput queue; a single file is simpler for CRUD and atomic reads.

import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { logDir } from "./logger";
import { generateUlid } from "./id";

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  cwd: string;
  permissionMode: PermissionMode;
  favorite: boolean;
  description?: string;
}

export function projectsPath(): string {
  return join(logDir(), "projects.json");
}

export function listProjects(): Project[] {
  const p = projectsPath();
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(readFileSync(p, "utf8")) as unknown;
    return Array.isArray(arr) ? (arr as Project[]) : [];
  } catch {
    return [];
  }
}

export function getProject(id: string): Project | undefined {
  return listProjects().find((p) => p.id === id);
}

function saveProjects(projects: Project[]): void {
  mkdirSync(logDir(), { recursive: true });
  writeFileSync(projectsPath(), JSON.stringify(projects, null, 2), "utf8");
}

export function createProject(o: {
  name: string;
  cwd: string;
  permissionMode?: PermissionMode;
  favorite?: boolean;
  description?: string;
  nowMs?: number;
}): Project {
  const nowMs = o.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const project: Project = {
    id: generateUlid(nowMs),
    createdAt: now,
    updatedAt: now,
    name: o.name,
    cwd: o.cwd,
    permissionMode: o.permissionMode ?? "default",
    favorite: o.favorite ?? false,
    description: o.description,
  };
  const all = listProjects();
  all.push(project);
  saveProjects(all);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "cwd" | "permissionMode" | "favorite" | "description">>,
  nowMs?: number,
): Project | null {
  const all = listProjects();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated: Project = {
    ...all[idx]!,
    ...patch,
    updatedAt: new Date(nowMs ?? Date.now()).toISOString(),
  };
  all[idx] = updated;
  saveProjects(all);
  return updated;
}

export function deleteProject(id: string): boolean {
  const all = listProjects();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  saveProjects(all);
  return true;
}
