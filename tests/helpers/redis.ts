/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Redis, type RedisOptions } from "ioredis";

const exec = promisify(execFile);

/**
 * Every key the suite writes carries this prefix, so the suite never touches anything else on
 * the Redis it runs against, and the ACL user below is confined to it.
 */
export const KEY_PREFIX = "artest:";
const ACL_USER = "artest";
const ACL_PASSWORD = "artest-password";
const REDIS_IMAGE = "redis:7-alpine";

/**
 * A way to reach Redis as one user, with one ioredis `keyPrefix`. `admin` is the default user,
 * `acl` is restricted to the prefix the way a tenant of a shared Redis is.
 */
export type RedisProfile = {
  name: "prefixed" | "acl";
  keyPrefix: string;
  username?: string;
  password?: string;
};

export const PROFILES = {
  prefixed: { name: "prefixed", keyPrefix: KEY_PREFIX },
  acl: {
    name: "acl",
    keyPrefix: KEY_PREFIX,
    username: ACL_USER,
    password: ACL_PASSWORD,
  },
} as const satisfies Record<string, RedisProfile>;

/**
 * The rules of a tenant on a shared Redis: its own keys and channels only, and no command that
 * could undo the isolation (ACL, CONFIG, FLUSHALL, MONITOR...). INFO stays, ioredis reads it.
 */
export function aclRules(): string[] {
  const prefix = KEY_PREFIX.slice(0, -1);
  return [
    "reset",
    "on",
    `>${ACL_PASSWORD}`,
    `~${prefix}:*`,
    `&${prefix}:*`,
    "+@all",
    "-@admin",
    "-@dangerous",
    "+info",
    "-function",
    "-script|flush",
  ];
}

export function redisAddress() {
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT);
  if (!host || !Number.isInteger(port)) {
    throw new Error(
      "REDIS_HOST and REDIS_PORT are not set, run the suite through bin/test.ts",
    );
  }
  return { host, port };
}

export function adminClient(): Redis {
  return new Redis({
    ...redisAddress(),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 1,
  });
}

export function clientFor(
  profile: RedisProfile,
  overrides: RedisOptions = {},
): Redis {
  return new Redis({
    ...connectionOptions(profile),
    maxRetriesPerRequest: 1,
    ...overrides,
  });
}

/**
 * The options an application would declare for its `main` connection under this profile.
 */
export function connectionOptions(profile: RedisProfile) {
  return {
    ...redisAddress(),
    db: 0,
    keyPrefix: profile.keyPrefix,
    ...(profile.username
      ? { username: profile.username, password: profile.password }
      : {}),
  };
}

/**
 * Deletes every key under the suite's prefix, and nothing else.
 */
export async function clearPrefix(): Promise<void> {
  const admin = adminClient();
  try {
    let cursor = "0";
    do {
      const [next, keys] = await admin.scan(
        cursor,
        "MATCH",
        `${KEY_PREFIX}*`,
        "COUNT",
        500,
      );
      if (keys.length > 0) {
        await admin.del(...keys);
      }
      cursor = next;
    } while (cursor !== "0");
  } finally {
    await admin.quit();
  }
}

async function waitForPing(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const admin = new Redis({
      ...redisAddress(),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    admin.on("error", () => {});
    try {
      await admin.connect();
      await admin.ping();
      await admin.quit();
      return;
    } catch (error) {
      lastError = error;
      admin.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Redis did not answer PING within ${timeoutMs}ms`, {
    cause: lastError,
  });
}

/**
 * Starts a throwaway Redis container unless REDIS_HOST already points at one (a CI service),
 * waits for it, and creates the ACL user. Returns the teardown.
 */
export async function startRedis(): Promise<() => Promise<void>> {
  let containerId: string | undefined;

  if (!process.env.REDIS_HOST) {
    const { stdout } = await exec("docker", [
      "run",
      "--detach",
      "--rm",
      "--label",
      "adonis-resque-test=1",
      "--publish",
      "127.0.0.1::6379",
      REDIS_IMAGE,
    ]);
    containerId = stdout.trim();
    const { stdout: mapping } = await exec("docker", [
      "port",
      containerId,
      "6379/tcp",
    ]);
    const port = mapping.trim().split("\n")[0].split(":").pop();
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_PORT = port;
  }

  try {
    await waitForPing(15_000);
    const admin = adminClient();
    await admin.call("ACL", "SETUSER", ACL_USER, ...aclRules());
    await admin.quit();
  } catch (error) {
    if (containerId) {
      await exec("docker", ["stop", containerId]);
    }
    throw error;
  }

  return async () => {
    if (containerId) {
      await exec("docker", ["stop", containerId]);
      return;
    }
    await clearPrefix();
    const admin = adminClient();
    await admin.call("ACL", "DELUSER", ACL_USER);
    await admin.quit();
  };
}
