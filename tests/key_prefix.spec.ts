/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import app from "@adonisjs/core/services/app";
import { test } from "@japa/runner";
import { Plugins, Queue, Scheduler, Worker } from "../node_resque.js";
import { getConnection } from "../services/main.js";
import { bootTestApp } from "./helpers/app.js";
import {
  KEY_PREFIX,
  PROFILES,
  adminClient,
  clearPrefix,
  connectionOptions,
  type RedisProfile,
} from "./helpers/redis.js";

type Connection = Record<string, unknown>;

/**
 * The connection 3.0.0 handed to node-resque: the application's options as they are, ioredis
 * `keyPrefix` included, and node-resque's default namespace.
 */
function legacyConnection(profile: RedisProfile): Connection {
  const options = connectionOptions(profile);
  return {
    host: options.host,
    port: options.port,
    options,
    pkg: "ioredis",
    database: 0,
  };
}

async function withPackageConnection<T>(
  profile: RedisProfile,
  run: (connection: Connection) => Promise<T>,
): Promise<T> {
  const testApp = await bootTestApp(profile);
  try {
    return await run(getConnection() as Connection);
  } finally {
    await testApp.terminate();
  }
}

/**
 * Every key under the prefix, read as the admin, unprefixed reads and all.
 */
async function keysUnder(prefix: string): Promise<string[]> {
  const admin = adminClient();
  try {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await admin.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        500,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== "0");
    return keys.sort();
  } finally {
    await admin.quit();
  }
}

const FAR_FUTURE = Date.UTC(2100, 0, 1);

/**
 * Writes every family of key node-resque has: queues, a delayed job and its timestamp index, a
 * queue lock and a delayed-queue check, a job lock held during a perform, processed and failed
 * stats, a failed job, worker registration and ping, scheduler leadership. Returns the keys while
 * the locked job is still running, then stops everything.
 */
async function writeEveryKeyFamily(
  connection: Connection,
  prefix: string,
): Promise<string[]> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const lockedStarted = new Promise<void>((resolve) => (started = resolve));
  const jobs = {
    Echo: { perform: async (value: string) => value },
    Fail: {
      perform: async () => {
        throw new Error("expected failure");
      },
    },
    Locked: {
      plugins: [Plugins.JobLock, Plugins.QueueLock, Plugins.DelayQueueLock],
      pluginOptions: {},
      perform: async () => {
        started();
        await released;
      },
    },
  };

  const queue = new Queue({ connection }, jobs);
  queue.on("error", () => {});
  await queue.connect();
  await queue.enqueue("default", "Echo", ["now"]);
  await queue.enqueueAt(FAR_FUTURE, "default", "Echo", ["later"]);
  await queue.enqueue("default", "Fail", []);

  const worker = new Worker(
    { connection, queues: ["default"], timeout: 50, name: "w1" },
    jobs,
  );
  worker.on("error", () => {});
  let settled = 0;
  const twoSettled = new Promise<void>((resolve) => {
    const settle = () => ++settled === 2 && resolve();
    worker.on("success", settle);
    worker.on("failure", settle);
  });
  const scheduler = new Scheduler({ connection, name: "s1", timeout: 50 });
  scheduler.on("error", () => {});
  await scheduler.connect();
  await scheduler.start();
  await worker.connect();
  await worker.start();

  await twoSettled;
  await queue.enqueue("default", "Locked", ["held"]);
  await lockedStarted;
  const keys = await keysUnder(prefix);

  release();
  await worker.end();
  await scheduler.end();
  await queue.end();
  return keys;
}

test.group(
  "keyPrefix: SCAN-based reads under the prefix-restricted ACL",
  (group) => {
    group.each.setup(async () => {
      await clearPrefix();
      const admin = adminClient();
      await admin.call("ACL", "LOG", "RESET");
      await admin.quit();
    });

    test("timestamps(), locks() and stats() see what was written", async ({
      expect,
    }) => {
      await withPackageConnection(PROFILES.acl, async (connection) => {
        const queue = new Queue({ connection }, {});
        await queue.connect();
        try {
          await queue.enqueueAt(FAR_FUTURE, "default", "Echo", ["later"]);
          await queue.connection.redis.set(
            queue.connection.key("lock:probe"),
            "1",
          );
          await queue.connection.redis.incr(
            queue.connection.key("stat", "processed"),
          );

          expect(await queue.timestamps()).toEqual([FAR_FUTURE]);
          expect(await queue.locks()).toEqual({ "lock:probe": "1" });
          expect(await queue.stats()).toEqual({ processed: "1" });
        } finally {
          await queue.end();
        }
      });
    });

    test("the scheduler cleans a worker whose ping went stale", async ({
      expect,
    }) => {
      await withPackageConnection(PROFILES.acl, async (connection) => {
        const scheduler = new Scheduler({
          connection,
          stuckWorkerTimeout: 1_000,
        });
        scheduler.on("error", () => {});
        await scheduler.connect();
        try {
          const redis = scheduler.connection.redis;
          const pingKey = scheduler.connection.key(
            "worker",
            "ping",
            "stale-host:1",
          );
          const anHourAgo = Math.round(Date.now() / 1000) - 3600;
          await redis.set(
            pingKey,
            JSON.stringify({ name: "stale-host:1", time: anHourAgo }),
          );
          await redis.sadd(
            scheduler.connection.key("workers"),
            "stale-host:1:default",
          );

          // `private` in node-resque's declarations, public at runtime: the scheduler's own sweep.
          await (
            scheduler as unknown as { checkStuckWorkers(): Promise<void> }
          ).checkStuckWorkers();

          expect(await redis.exists(pingKey)).toBe(0);
        } finally {
          await scheduler.end();
        }
      });
    });

    test("no command is refused by the ACL", async ({ expect }) => {
      await withPackageConnection(PROFILES.acl, async (connection) => {
        await writeEveryKeyFamily(connection, KEY_PREFIX);
      });

      const admin = adminClient();
      const log = (await admin.call("ACL", "LOG")) as unknown[];
      await admin.quit();
      expect(log).toEqual([]);
    }).timeout(15_000);
  },
);

test.group("keyPrefix: key layout", (group) => {
  group.each.setup(() => clearPrefix());

  for (const keyPrefix of [KEY_PREFIX, `${KEY_PREFIX}nocolon`]) {
    test("is byte-identical to 3.0.0 for the prefix {$self}")
      .with([keyPrefix])
      .run(async ({ expect }) => {
        const profile: RedisProfile = { name: "prefixed", keyPrefix };

        const before = await writeEveryKeyFamily(
          legacyConnection(profile),
          keyPrefix,
        );
        await clearPrefix();
        const after = await withPackageConnection(profile, (connection) =>
          writeEveryKeyFamily(connection, keyPrefix),
        );

        expect(before.length).toBeGreaterThan(10);
        expect(after).toEqual(before);
      })
      .timeout(20_000);
  }
});

test.group("keyPrefix: getConnection()", () => {
  test("hands node-resque the prefix as its namespace, and ioredis none", async ({
    expect,
  }) => {
    await withPackageConnection(PROFILES.prefixed, async (connection) => {
      expect(connection.namespace).toBe(`${KEY_PREFIX}resque`);
      expect(connection.options).not.toHaveProperty("keyPrefix");
    });
  });

  test("keeps node-resque's default namespace without a prefix", async ({
    expect,
  }) => {
    await withPackageConnection(
      { name: "prefixed", keyPrefix: "" },
      async (connection) => {
        expect(connection.namespace).toBe("resque");
        expect(connection.options).not.toHaveProperty("keyPrefix");
      },
    );
  });

  test("leaves the application's redis config untouched", async ({
    expect,
  }) => {
    await withPackageConnection(PROFILES.prefixed, async () => {
      expect(app.config.get("redis.connections.main.keyPrefix")).toBe(
        KEY_PREFIX,
      );
    });
  });
});
