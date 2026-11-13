/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from "@japa/runner";
import { Worker } from "../node_resque.js";
import { loadedNodeResque } from "./helpers/node_resque_version.js";

test.group("node-resque version under test", () => {
  test("the package loads the release NODE_RESQUE_VERSION selects", async ({
    expect,
  }) => {
    const selected = process.env.NODE_RESQUE_VERSION;
    const loaded = await loadedNodeResque();

    if (!selected) {
      expect(loaded.alias).toBeUndefined();
      return;
    }

    expect(loaded.version).toBe(selected);
    const aliased = await import(`node-resque-${selected}`);
    expect(Worker).toBe((aliased.default ?? aliased).Worker);
  });
});
