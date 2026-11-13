/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from "@japa/runner";
import { createQueue } from "../queue.js";
import { createScheduler } from "../scheduler.js";
import { createMultiWorker, createWorker } from "../services/main.js";
import { type ResqueError } from "../types.js";
import { bootTestApp } from "./helpers/app.js";
import { PROFILES, clearPrefix } from "./helpers/redis.js";

type Emitting = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  connection: { redis: { emit(event: string, ...args: unknown[]): boolean } };
};

type Instance = {
  source: ResqueError["source"];
  /** Builds the instance through the package and returns the client whose error to raise. */
  start(): Promise<{
    instance: Emitting;
    client: Emitting["connection"]["redis"];
    stop(): Promise<unknown>;
  }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The 4 node-resque emitters the package builds, each raising an error the way a dropped Redis
 * connection does: an `error` event on the ioredis client, which node-resque forwards up its own
 * chain (connection, queue, worker, multi-worker).
 */
const INSTANCES: Instance[] = [
  {
    source: "queue",
    async start() {
      const queue = createQueue({});
      await queue.connect();
      return {
        instance: queue as unknown as Emitting,
        client: (queue as unknown as Emitting).connection.redis,
        stop: () => queue.end(),
      };
    },
  },
  {
    source: "worker",
    async start() {
      const worker = createWorker({}, ["default"]);
      await worker.connect();
      return {
        instance: worker as unknown as Emitting,
        client: (worker as unknown as Emitting).connection.redis,
        stop: () => worker.end(),
      };
    },
  },
  {
    source: "multiWorker",
    async start() {
      const multiWorker = createMultiWorker({}, ["default"]);
      multiWorker.start();
      const internals = multiWorker as unknown as { workers: Emitting[] };
      const deadline = Date.now() + 3_000;
      while (internals.workers.length === 0 && Date.now() < deadline)
        await sleep(20);
      await sleep(100);
      return {
        instance: multiWorker as unknown as Emitting,
        client: internals.workers[0].connection.redis,
        stop: () => multiWorker.end(),
      };
    },
  },
  {
    source: "scheduler",
    async start() {
      const scheduler = createScheduler();
      await scheduler.connect();
      return {
        instance: scheduler as unknown as Emitting,
        client: (scheduler as unknown as Emitting).connection.redis,
        stop: () => scheduler.end(),
      };
    },
  },
];

test.group(
  "error events of the node-resque instances the package builds",
  (group) => {
    let logged: unknown[][] = [];
    let events: ResqueError[] = [];

    group.each.setup(async () => {
      await clearPrefix();
      const app = await bootTestApp(PROFILES.prefixed);
      logged = [];
      events = [];
      const logger = await app.container.make("logger");
      logger.error = ((...args: unknown[]) => {
        logged.push(args);
      }) as typeof logger.error;
      const emitter = await app.container.make("emitter");
      emitter.on("resque:error", (event) => {
        events.push(event);
      });
      return () => app.terminate();
    });

    for (const { source, start } of INSTANCES) {
      test(`a Redis error under the ${source} is logged and emitted, never thrown`, async ({
        expect,
      }) => {
        const { client, stop } = await start();
        const error = new Error(`connection lost under the ${source}`);

        try {
          expect(() => client.emit("error", error)).not.toThrow();
          await sleep(20);

          expect(logged).toHaveLength(1);
          expect(logged[0][0]).toMatchObject({ err: error, source });
          expect(events).toHaveLength(1);
          expect(events[0]).toMatchObject({ source, error });
        } finally {
          await stop();
        }
      }).timeout(10_000);

      test(`a listener the application attaches to the ${source} still receives the error`, async ({
        expect,
      }) => {
        const { instance, client, stop } = await start();
        const received: unknown[] = [];
        instance.on("error", (error: unknown) => received.push(error));
        const error = new Error("boom");

        try {
          client.emit("error", error);
          await sleep(20);

          expect(received).toEqual([error]);
          expect(logged).toHaveLength(1);
        } finally {
          await stop();
        }
      }).timeout(10_000);
    }
  },
);

test.group("error events on a Redis that refuses connections", () => {
  test("a Queue logs each refused connection and the process stays alive", async ({
    expect,
  }) => {
    // Port 1 refuses at once. A short retry delay gives several refusals within the test.
    const app = await bootTestApp(PROFILES.prefixed, {
      port: 1,
      retryStrategy: () => 50,
    });
    const logger = await app.container.make("logger");
    const logged: unknown[][] = [];
    logger.error = ((...args: unknown[]) => {
      logged.push(args);
    }) as typeof logger.error;
    const queue = createQueue({});

    try {
      void queue.connect().catch(() => {});
      await sleep(400);

      expect(logged.length).toBeGreaterThan(1);
      const first = logged[0][0] as {
        err: NodeJS.ErrnoException;
        source: string;
      };
      expect(first.source).toBe("queue");
      expect(first.err.code).toBe("ECONNREFUSED");
    } finally {
      // node-resque's end() only disconnects a client that once connected: this one never did,
      // and would otherwise keep reconnecting, listener-less, after the test.
      (
        queue.connection.redis as unknown as { disconnect(): void }
      ).disconnect();
      await queue.end();
      await app.terminate();
    }
  }).timeout(10_000);
});
