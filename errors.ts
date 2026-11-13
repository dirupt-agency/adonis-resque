/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import app from "@adonisjs/core/services/app";
import { type ResqueConfig, type ResqueError } from "./types.js";

type ErrorEmitter = {
  on(event: "error", listener: (...args: any[]) => void): unknown;
};

/**
 * node-resque reports non-fatal Redis errors as `error` events and carries on: a failed poll is
 * retried, the ioredis client reconnects. An `error` event with no listener throws, so without
 * this listener the first Redis error of a failover killed the process. Every node-resque
 * instance the package builds gets this listener: the Queue of the provider, the Worker or
 * MultiWorker and the Scheduler of `resque:start`. Errors forwarded from inner connections and
 * queues reach these 4.
 *
 * Each error is logged through the logger named by the `logger` config key (the default one when
 * it is null), and emitted as the `resque:error` event. A listener the application attaches to
 * the instance still receives every error.
 */
export function reportErrors<T extends ErrorEmitter>(
  instance: T,
  source: ResqueError["source"],
): T {
  instance.on("error", (error: unknown, ...context: unknown[]) => {
    void report({ source, error, ...contextOf(source, context) });
  });
  return instance;
}

/**
 * The arguments node-resque passes after the error: `(queue, job)` for a Worker,
 * `(workerId, queue, job)` for a MultiWorker, nothing for a Queue or a Scheduler.
 */
function contextOf(
  source: ResqueError["source"],
  context: unknown[],
): Partial<ResqueError> {
  if (source === "worker") {
    const [queue, job] = context;
    return { queue: queue as string | undefined, job };
  }
  if (source === "multiWorker") {
    const [workerId, queue, job] = context;
    return {
      workerId: workerId as number | undefined,
      queue: queue as string | undefined,
      job,
    };
  }
  return {};
}

/**
 * Never throws: it runs inside an `error` listener, where a throw would bring back the crash it
 * exists to prevent.
 */
async function report(event: ResqueError): Promise<void> {
  try {
    const loggerName = app.config.get<ResqueConfig["logger"]>(
      "resque.logger",
      null,
    );
    const loggerManager = await app.container.make("logger");
    const logger = loggerName ? loggerManager.use(loggerName) : loggerManager;
    logger.error(
      {
        err: event.error,
        source: event.source,
        workerId: event.workerId,
        queue: event.queue,
      },
      `resque ${event.source} error`,
    );
    const emitter = await app.container.make("emitter");
    await emitter.emit("resque:error", event);
  } catch {
    // Nothing left to report to.
  }
}
