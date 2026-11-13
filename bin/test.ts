/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

// First import on purpose: it redirects node-resque before any other module loads it.
import { loadedNodeResque } from "../tests/helpers/node_resque_version.js";
import { expect } from "@japa/expect";
import { configure, processCLIArgs, run } from "@japa/runner";
import { startRedis } from "../tests/helpers/redis.js";

/**
 * The suite runs against a real Redis. Without REDIS_HOST, bin/test.ts starts a throwaway
 * container (Docker required) and stops it at the end. With REDIS_HOST and REDIS_PORT, it uses
 * that server, touches only keys under the suite's prefix, and creates then deletes one ACL user.
 */
const nodeResque = await loadedNodeResque();
console.log(
  `node-resque ${nodeResque.version}${nodeResque.alias ? ` (${nodeResque.alias})` : " (locked)"}`,
);

processCLIArgs(process.argv.splice(2));
configure({
  files: ["tests/**/*.spec.ts"],
  plugins: [expect()],
  setup: [startRedis],
  timeout: 10_000,
});

run();
