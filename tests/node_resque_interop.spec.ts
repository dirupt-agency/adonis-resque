/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from "@japa/runner";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as pkg from "../index.js";
import { type Queue, type Scheduler, type Worker } from "../index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "build",
  "tests",
  "bin",
  ".scratch",
  ".git",
]);

/**
 * The one module allowed to load node-resque at runtime.
 */
const ACCESS_MODULE = "node_resque.ts";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
      }
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
        ? [path]
        : [];
    }),
  );
  return files.flat();
}

/**
 * Named value bindings an import or export statement takes from node-resque. Type-only
 * statements and `type` specifiers are erased at compile time, so they never reach Node's CJS
 * lexer and are not reported.
 */
function namedValueBindings(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const statements = code.matchAll(
    /\b(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*["']node-resque["']/g,
  );
  const bindings: string[] = [];
  for (const [, , typeOnly, specifiers] of statements) {
    if (typeOnly) {
      continue;
    }
    for (const specifier of specifiers.split(",")) {
      const name = specifier.trim();
      if (name !== "" && !name.startsWith("type ")) {
        bindings.push(name);
      }
    }
  }
  return bindings;
}

test.group("node-resque interop", () => {
  test("no source module takes a named value binding from node-resque", async ({
    expect,
  }) => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(ROOT)) {
      const name = relative(ROOT, file);
      if (name === ACCESS_MODULE) {
        continue;
      }
      for (const binding of namedValueBindings(await readFile(file, "utf8"))) {
        offenders.push(`${name}: ${binding}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the access module reads node-resque through its default import only", async ({
    expect,
  }) => {
    const source = await readFile(join(ROOT, ACCESS_MODULE), "utf8");

    expect(source).toMatch(/import\s+\w+\s+from\s+["']node-resque["']/);
    expect(namedValueBindings(source)).toEqual([]);
  });

  test("the public entry still exposes the node-resque values", ({
    expect,
  }) => {
    expect(typeof pkg.Worker).toBe("function");
    expect(typeof pkg.Queue).toBe("function");
    expect(typeof pkg.Scheduler).toBe("function");
    expect(Object.keys(pkg.Plugins).sort()).toEqual([
      "DelayQueueLock",
      "JobLock",
      "Noop",
      "QueueLock",
      "Retry",
    ]);
    expect(pkg.Plugin.jobLock()[0]).toBe(pkg.Plugins.JobLock);
  });

  test("Worker, Queue and Scheduler stay usable as types", ({ expect }) => {
    // Compile-time check, enforced by `pnpm typecheck`: each name is both a value and a type.
    const accepts = (
      _worker?: Worker,
      _queue?: Queue,
      _scheduler?: Scheduler,
    ) => true;

    expect(accepts()).toBe(true);
  });
});
