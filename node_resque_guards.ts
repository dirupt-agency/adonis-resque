/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Guards against 3 defects of node-resque's Worker and MultiWorker, applied once per process to
 * node-resque's own prototypes by `node_resque.ts`, so every Worker and MultiWorker is covered,
 * including one a consumer builds from the classes this package re-exports.
 *
 * 1. An ended worker re-arms itself (actionhero/node-resque#1346). A worker listening to `*` runs
 *    `checkQueues()` after an empty poll, which ends with `track()`, and `track()` sets `running`
 *    back to `true`. When the MultiWorker ends that worker in the middle of `checkQueues()`, the
 *    worker is re-armed after `end()` closed its connection, and it polls that closed connection
 *    every `timeout` until the process exits. Fix: `end()` marks the worker before any await,
 *    `start()` clears the mark, `track()` and `pause()` do nothing on a marked worker, and a poll
 *    failing after `end()` is silent.
 * 2. A failed queue listing stops a worker for good. When a `*` worker knows no queue, `poll()`
 *    lists them outside its `try`, so a Redis error there rejects the poll and skips the pause
 *    that schedules the next one. Fix: a rejected poll is reported as an `error` event, then the
 *    worker pauses and polls again, as node-resque already does for a failed job fetch.
 * 3. A failed pool check stops the MultiWorker resizing for good. `checkWrapper()` has no `try`:
 *    a Redis error is an unhandled rejection and the next check is never scheduled. Fix: the error
 *    is reported as an `error` event and the next check is always scheduled.
 *
 * Each guard delegates to node-resque's own method, so an upstream change inside those methods
 * still applies. The guards are only applied to the releases they were proven against.
 */

/**
 * Releases the guards are proven against by `tests/part_b.spec.ts`, run on 9.3.5, 9.4.0, 9.5.2
 * and 9.7.1 (`pnpm test:matrix`). The guarded methods are identical from 9.3.5 to 9.7.1, except
 * that before 9.5 the pause timer calls `poll()` without a `catch`, which the guarded `poll()`
 * makes harmless. `package.json` declares the same range for node-resque, a test holds them
 * equal: a new minor moves both, with its alias in the matrix.
 */
export const GUARDED_RANGE = { from: "9.3.5", below: "9.8.0" } as const;

const APPLIED = Symbol.for("@dirupt/adonis-resque.node-resque-guards");

type GuardedWorker = {
  ended?: boolean;
  working: boolean;
  queue: string | null;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  start(): Promise<void>;
  end(): Promise<void>;
  track(): Promise<unknown>;
  pause(): Promise<void>;
  poll(nQueue?: number): Promise<unknown>;
};

type GuardedMultiWorker = {
  options: { checkTimeout: number };
  checkTimer: NodeJS.Timeout | null;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  checkWorkers(): Promise<{ verb: string; eventLoopDelay: number }>;
  checkWrapper(): Promise<void>;
};

type GuardableModule = {
  Worker: { prototype: object };
  MultiWorker: { prototype: object };
};

function parse(version: string): number[] {
  return version.split("-")[0].split(".").map(Number);
}

function compare(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function isGuardedRelease(version: string): boolean {
  const parsed = parse(version);
  if (parsed.some(Number.isNaN)) {
    return false;
  }
  return (
    compare(parsed, parse(GUARDED_RANGE.from)) >= 0 &&
    compare(parsed, parse(GUARDED_RANGE.below)) < 0
  );
}

function guardWorker(prototype: GuardedWorker): void {
  const { start, end, track, pause, poll } = prototype;

  // A worker started again after end() is running again: the mark only holds between the two.
  prototype.start = async function (this: GuardedWorker) {
    this.ended = false;
    return start.call(this);
  };

  prototype.end = async function (this: GuardedWorker) {
    this.ended = true;
    return end.call(this);
  };

  prototype.track = async function (this: GuardedWorker) {
    if (this.ended) {
      return;
    }
    return track.call(this);
  };

  prototype.pause = async function (this: GuardedWorker) {
    if (this.ended) {
      return;
    }
    return pause.call(this);
  };

  prototype.poll = async function (this: GuardedWorker, nQueue?: number) {
    try {
      return await poll.call(this, nQueue);
    } catch (error) {
      // A poll still in flight when the worker was ended fails on the closed connection. That
      // is the end, not an error, and a MultiWorker removes an ended worker's `error` listeners
      // right away, so emitting it would throw.
      if (this.ended) {
        return null;
      }
      this.emit("error", error, this.queue);
      this.working = false;
      await this.pause();
      return null;
    }
  };
}

function guardMultiWorker(prototype: GuardedMultiWorker): void {
  prototype.checkWrapper = async function (this: GuardedMultiWorker) {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }
    try {
      const { verb, eventLoopDelay } = await this.checkWorkers();
      this.emit("multiWorkerAction", verb, eventLoopDelay);
    } catch (error) {
      this.emit("error", error);
    }
    this.checkTimer = setTimeout(() => {
      void this.checkWrapper();
    }, this.options.checkTimeout);
  };
}

/**
 * Applies the guards to node-resque's prototypes, once per process. Returns whether they are in
 * place. Outside the proven range nothing is changed and a warning says so, since the guards
 * override internals a release may have changed.
 */
export function guardNodeResque(
  nodeResque: GuardableModule,
  version: string,
): boolean {
  const worker = nodeResque.Worker.prototype as GuardedWorker & {
    [APPLIED]?: true;
  };
  if (worker[APPLIED]) {
    return true;
  }
  if (!isGuardedRelease(version)) {
    process.emitWarning(
      `node-resque ${version} is outside ${GUARDED_RANGE.from} to <${GUARDED_RANGE.below}, the range @dirupt/adonis-resque guards. Its worker guards are not applied.`,
      { code: "ADONIS_RESQUE_UNGUARDED_NODE_RESQUE" },
    );
    return false;
  }

  guardWorker(worker);
  guardMultiWorker(nodeResque.MultiWorker.prototype as GuardedMultiWorker);
  worker[APPLIED] = true;
  return true;
}
