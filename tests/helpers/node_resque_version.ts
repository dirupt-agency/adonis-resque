/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The node-resque releases the suite can run against besides the locked one, each installed
 * under an npm alias (`node-resque-<version>` in devDependencies).
 */
export const SELECTABLE_VERSIONS = ["9.3.5", "9.4.0", "9.5.2"] as const;

let selectedAlias: string | undefined;

/**
 * Points every `node-resque` and `node-resque/<path>` specifier, from the package and from the
 * tests alike, at the aliased release NODE_RESQUE_VERSION names. Without the variable, nothing is
 * registered and the locked release is used. Must run before anything imports node-resque, which
 * is why `bin/test.ts` imports this module first.
 */
export function selectNodeResque(
  version = process.env.NODE_RESQUE_VERSION,
): void {
  if (!version) {
    return;
  }
  if (!(SELECTABLE_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(
      `NODE_RESQUE_VERSION=${version} is not installed, choose one of ${SELECTABLE_VERSIONS.join(", ")}`,
    );
  }

  const alias = `node-resque-${version}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "node-resque") {
        return nextResolve(alias, context);
      }
      if (specifier.startsWith("node-resque/")) {
        return nextResolve(
          alias + specifier.slice("node-resque".length),
          context,
        );
      }
      return nextResolve(specifier, context);
    },
  });
  selectedAlias = alias;
}

selectNodeResque();

/**
 * The release the bare `node-resque` specifier resolves to for this run, read from the
 * `package.json` of the module Node actually resolves, never from the selection itself.
 */
export async function loadedNodeResque(): Promise<{
  version: string;
  alias?: string;
}> {
  let directory = dirname(fileURLToPath(import.meta.resolve("node-resque")));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (manifest.name === "node-resque") {
        return { version: manifest.version, alias: selectedAlias };
      }
    } catch {}
    directory = dirname(directory);
  }
  throw new Error("node-resque resolves outside any node-resque package");
}
