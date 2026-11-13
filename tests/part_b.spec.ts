/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * The 3 node-resque defects `node_resque_guards.ts` guards against, reproduced on a real Redis.
 * Without the guards all 4 tests fail, each on the defect it reproduces.
 */

import { test } from "@japa/runner";
import { randomUUID } from "node:crypto";
import {
  MultiWorker,
  Queue,
  Worker,
  nodeResqueVersion,
} from "../node_resque.js";
import { PROFILES, clearPrefix, connectionOptions } from "./helpers/redis.js";

type RedisClient = { smembers(...args: unknown[]): Promise<string[]> };
type Observed = {
  running: boolean;
  queue: string | null;
  end(): Promise<void>;
  pollTimer: NodeJS.Timeout | null;
  connection: { redis: RedisClient };
  on(event: string, listener: (...args: any[]) => void): unknown;
  connect(): Promise<void>;
  start(): Promise<void>;
};

const jobs = { Echo: { perform: async (value: string) => value } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resqueConnection(namespace: string) {
  const options = connectionOptions(PROFILES.prefixed);
  return {
    host: options.host,
    port: options.port,
    options,
    pkg: "ioredis",
    database: 0,
    namespace,
  };
}

/**
 * Wraps `smembers` of the worker's own client so the next call runs `then` after Redis answered:
 * the moment `checkQueues()` sits between its listing and its `track()`.
 */
function onNextSmembers(
  worker: Observed,
  then: () => Promise<void>,
): Promise<void> {
  const client = worker.connection.redis;
  const smembers = client.smembers.bind(client);
  return new Promise((resolve, reject) => {
    let armed = true;
    client.smembers = async (...args: unknown[]) => {
      const result = await smembers(...args);
      if (armed) {
        armed = false;
        await then().then(resolve, reject);
      }
      return result;
    };
  });
}

/**
 * Asserts the ended worker stays stopped: nothing after `end`, `running` false, no error.
 */
async function expectStaysStopped(
  expect: any,
  worker: Observed,
  events: string[],
  errors: string[],
) {
  await sleep(600);
  expect(worker.running).toBe(false);
  expect(events.slice(events.lastIndexOf("end"))).toEqual(["end"]);
  expect(errors).toEqual([]);
}

function stopForGood(worker: Observed) {
  worker.running = false;
  if (worker.pollTimer) clearTimeout(worker.pollTimer);
}

test.group(`node-resque ${nodeResqueVersion} worker guards`, (group) => {
  group.each.setup(() => clearPrefix());

  test("a Worker ended inside checkQueues() stays stopped", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `race-${randomUUID()}`;
    const queue = new Queue({ connection: resqueConnection(namespace) }, jobs);
    await queue.connect();
    await queue.connection.redis.sadd(
      queue.connection.key("queues"),
      "default",
    );
    await queue.end();

    const worker = new Worker(
      { connection: resqueConnection(namespace), queues: ["*"], timeout: 100 },
      jobs,
    ) as unknown as Observed;
    cleanup(() => stopForGood(worker));
    const events: string[] = [];
    const errors: string[] = [];
    for (const event of ["poll", "pause", "end"])
      worker.on(event, () => events.push(event));
    worker.on("error", (error: Error) => errors.push(error.message));
    await worker.connect();
    await worker.start();

    await onNextSmembers(worker, () => worker.end());

    await expectStaysStopped(expect, worker, events, errors);
  }).timeout(10_000);

  test("a Worker the MultiWorker built, ended inside checkQueues(), stays stopped", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `multi-race-${randomUUID()}`;
    const multiWorker = new MultiWorker(
      {
        connection: resqueConnection(namespace),
        queues: ["*"],
        timeout: 100,
        checkTimeout: 50,
        minTaskProcessors: 1,
        maxTaskProcessors: 1,
      },
      jobs,
    ) as unknown as {
      workers: Observed[];
      on: Observed["on"];
      start(): void;
      end(): Promise<void>;
      checkTimer: NodeJS.Timeout | null;
      running: boolean;
    };
    multiWorker.on("error", () => {});
    multiWorker.start();
    cleanup(async () => {
      multiWorker.running = false;
      if (multiWorker.checkTimer) clearTimeout(multiWorker.checkTimer);
      for (const worker of multiWorker.workers) stopForGood(worker);
    });

    const deadline = Date.now() + 3_000;
    while (multiWorker.workers.length === 0 && Date.now() < deadline)
      await sleep(20);
    const worker = multiWorker.workers[0];
    expect(worker).toBeDefined();
    while (!worker.running && Date.now() < deadline) await sleep(20);
    multiWorker.running = false;
    if (multiWorker.checkTimer) clearTimeout(multiWorker.checkTimer);

    const events: string[] = [];
    const errors: string[] = [];
    for (const event of ["poll", "pause", "end"])
      worker.on(event, () => events.push(event));
    worker.on("error", (error: Error) => errors.push(error.message));

    await onNextSmembers(worker, () => worker.end());

    await expectStaysStopped(expect, worker, events, errors);
  }).timeout(10_000);

  test("a Worker whose queue listing fails keeps polling and works the next job", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `poll-${randomUUID()}`;
    const worker = new Worker(
      { connection: resqueConnection(namespace), queues: ["*"], timeout: 100 },
      jobs,
    ) as unknown as Observed & { end(): Promise<void> };
    const errors: string[] = [];
    worker.on("error", (error: Error) => errors.push(error.message));
    const performed: unknown[] = [];
    worker.on("success", (_queue: string, _job: unknown, result: unknown) =>
      performed.push(result),
    );
    await worker.connect();
    await worker.start();
    cleanup(async () => {
      stopForGood(worker);
      await worker.end();
    });

    // The next listing fails, as it does while Redis fails over.
    const client = worker.connection.redis;
    const smembers = client.smembers.bind(client);
    let failNext = true;
    client.smembers = async (...args: unknown[]) => {
      if (failNext) {
        failNext = false;
        throw new Error(
          "Reached the max retries per request limit (which is 3).",
        );
      }
      return smembers(...args);
    };
    while (failNext) await sleep(20);

    const queue = new Queue({ connection: resqueConnection(namespace) }, jobs);
    await queue.connect();
    const token = randomUUID();
    await queue.enqueue("default", "Echo", [token]);
    await queue.end();

    const deadline = Date.now() + 2_000;
    while (performed.length === 0 && Date.now() < deadline) await sleep(20);

    expect(errors).toEqual([
      "Reached the max retries per request limit (which is 3).",
    ]);
    expect(performed).toEqual([token]);
  }).timeout(10_000);

  test("a failed pool check of the MultiWorker is reported and the next check runs", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `check-${randomUUID()}`;
    const multiWorker = new MultiWorker(
      {
        connection: resqueConnection(namespace),
        queues: ["default"],
        timeout: 100,
        checkTimeout: 50,
        minTaskProcessors: 1,
        maxTaskProcessors: 1,
      },
      jobs,
    ) as unknown as {
      on: Observed["on"];
      start(): void;
      end(): Promise<void>;
      checkTimer: NodeJS.Timeout | null;
      checkWorkers(): Promise<unknown>;
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const errors: string[] = [];
    multiWorker.on("error", (error: Error) => errors.push(error.message));
    let actions = 0;
    multiWorker.on("multiWorkerAction", () => actions++);
    cleanup(async () => {
      process.off("unhandledRejection", onUnhandled);
      await multiWorker.end();
      if (multiWorker.checkTimer) clearTimeout(multiWorker.checkTimer);
    });

    const checkWorkers = multiWorker.checkWorkers.bind(multiWorker);
    let failNext = true;
    multiWorker.checkWorkers = async () => {
      if (failNext) {
        failNext = false;
        throw new Error(
          "Reached the max retries per request limit (which is 3).",
        );
      }
      return checkWorkers();
    };
    multiWorker.start();
    await sleep(500);

    expect(unhandled).toEqual([]);
    expect(errors).toEqual([
      "Reached the max retries per request limit (which is 3).",
    ]);
    expect(actions).toBeGreaterThan(0);
  }).timeout(10_000);

  test("a Worker started again after end() works jobs again", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `restart-${randomUUID()}`;
    const worker = new Worker(
      {
        connection: resqueConnection(namespace),
        queues: ["default"],
        timeout: 50,
      },
      jobs,
    ) as unknown as Observed;
    const errors: string[] = [];
    worker.on("error", (error: Error) => errors.push(error.message));
    const performed: unknown[] = [];
    worker.on("success", (_queue: string, _job: unknown, result: unknown) =>
      performed.push(result),
    );
    cleanup(async () => {
      stopForGood(worker);
      await worker.end();
    });

    await worker.connect();
    await worker.start();
    await worker.end();
    await worker.connect();
    await worker.start();

    const queue = new Queue({ connection: resqueConnection(namespace) }, jobs);
    await queue.connect();
    const token = randomUUID();
    await queue.enqueue("default", "Echo", [token]);
    await queue.end();

    const deadline = Date.now() + 2_000;
    while (performed.length === 0 && Date.now() < deadline) await sleep(20);

    expect(worker.running).toBe(true);
    expect(performed).toEqual([token]);
    expect(errors).toEqual([]);
  }).timeout(10_000);

  test("an in-flight poll that fails after end() emits no error", async ({
    expect,
    cleanup,
  }) => {
    const namespace = `ended-poll-${randomUUID()}`;
    const worker = new Worker(
      { connection: resqueConnection(namespace), queues: ["*"], timeout: 100 },
      jobs,
    ) as unknown as Observed;
    cleanup(() => stopForGood(worker));
    const errors: string[] = [];
    worker.on("error", (error: Error) => errors.push(error.message));
    await worker.connect();

    // The poll's queue listing is in flight when the worker is ended, then fails on the closed
    // connection: what a MultiWorker scaling down does, right before it removes the worker's
    // `error` listeners.
    const client = worker.connection.redis;
    let ended!: () => void;
    const endedInFlight = new Promise<void>((resolve) => (ended = resolve));
    client.smembers = async () => {
      await worker.end();
      ended();
      throw new Error("Connection is closed.");
    };
    await worker.start();
    await endedInFlight;
    await sleep(300);

    expect(errors).toEqual([]);
    expect(worker.running).toBe(false);
  }).timeout(10_000);
});
