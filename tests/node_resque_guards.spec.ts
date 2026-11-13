/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from "@japa/runner";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { nodeResqueGuarded, nodeResqueVersion } from "../node_resque.js";
import {
  GUARDED_RANGE,
  guardNodeResque,
  isGuardedRelease,
} from "../node_resque_guards.js";

function fakeModule() {
  class Worker {
    async end() {}
    async track() {}
    async pause() {}
    async poll() {}
  }
  class MultiWorker {
    async checkWrapper() {}
  }
  return { Worker, MultiWorker };
}

test.group("node-resque guards", () => {
  test("are in place for the release this run loaded", ({ expect }) => {
    expect(isGuardedRelease(nodeResqueVersion)).toBe(true);
    expect(nodeResqueGuarded).toBe(true);
  });

  test("cover the releases they were proven against, and only those", ({
    expect,
  }) => {
    for (const version of ["9.3.5", "9.4.0", "9.5.2", "9.7.1", "9.7.9"]) {
      expect(isGuardedRelease(version)).toBe(true);
    }
    for (const version of ["9.3.4", "9.8.0", "10.0.0", "8.2.0", "next"]) {
      expect(isGuardedRelease(version)).toBe(false);
    }
  });

  test("leave a release outside the range untouched and warn", async ({
    expect,
  }) => {
    const module = fakeModule();
    const before = {
      ...Object.getOwnPropertyDescriptors(module.Worker.prototype),
    };
    const warned = once(process, "warning");

    expect(guardNodeResque(module, "9.8.0")).toBe(false);

    const [warning] = (await warned) as [Error & { code?: string }];
    expect(warning.code).toBe("ADONIS_RESQUE_UNGUARDED_NODE_RESQUE");
    expect(Object.getOwnPropertyDescriptors(module.Worker.prototype)).toEqual(
      before,
    );
  });

  test("apply once, however many times they are requested", ({ expect }) => {
    const module = fakeModule();

    expect(guardNodeResque(module, "9.7.1")).toBe(true);
    const { end, poll } = module.Worker.prototype;
    const { checkWrapper } = module.MultiWorker.prototype;
    expect(guardNodeResque(module, "9.7.1")).toBe(true);

    expect(module.Worker.prototype.end).toBe(end);
    expect(module.Worker.prototype.poll).toBe(poll);
    expect(module.MultiWorker.prototype.checkWrapper).toBe(checkWrapper);
  });

  test("cover exactly the range package.json declares for node-resque", async ({
    expect,
  }) => {
    // Moving one without the other either installs an unguarded release or guards one nothing
    // installs: a new node-resque minor moves both, with its alias in the test matrix.
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );

    expect(manifest.dependencies["node-resque"]).toBe(
      `>=${GUARDED_RANGE.from} <${GUARDED_RANGE.below}`,
    );
  });
});
