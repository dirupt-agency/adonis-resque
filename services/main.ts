/*
 * @dirupt/adonis-resque
 *
 * Original work (c) Dai Jie <https://github.com/shiny>
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import app from "@adonisjs/core/services/app";
import { type Jobs } from "node-resque";
import { MultiWorker, Worker } from "../node_resque.js";
import { type RedisConnections } from "@adonisjs/redis/types";
import { type defineConfig } from "../define_config.js";
import { reportErrors } from "../errors.js";

/**
 * The connection node-resque builds its own ioredis clients from, after the application's redis
 * connection named by `redisConnection`.
 *
 * The ioredis `keyPrefix` is moved into node-resque's namespace. ioredis prefixes every key it
 * sends but never a SCAN `MATCH` pattern, so with the prefix left to ioredis node-resque's
 * SCAN-based reads (`timestamps()`, `locks()`, `stats()`, the scheduler's stuck worker sweep)
 * matched nothing. node-resque builds every key as `<namespace>:<parts>`, so the namespace
 * `<keyPrefix>resque` gives byte for byte the keys ioredis gave with `<keyPrefix>` in front of
 * `resque:<parts>`, for any prefix, with or without a trailing colon. The application's config
 * object is copied, never changed.
 */
export function getConnection() {
  const resqueConfig =
    app.config.get<ReturnType<typeof defineConfig>>("resque");
  const connections = app.config.get<RedisConnections>("redis.connections");
  const { keyPrefix = "", ...options } = connections[
    resqueConfig.redisConnection
  ] as any;
  return {
    host: options.host,
    port: Number.parseInt(options.port ?? "6379"),
    options,
    pkg: "ioredis",
    database: options.db ?? 0,
    namespace: `${keyPrefix}resque`,
  };
}

export function createWorker(jobs: Jobs, queues: string[]) {
  const workerOption = app.config.get<Worker["options"]>("resque.workerOption");
  return reportErrors(
    new Worker(
      {
        connection: getConnection(),
        queues,
        ...workerOption,
      },
      jobs,
    ),
    "worker",
  );
}

export function createMultiWorker(jobs: Jobs, queues: string[]) {
  const multiWorkerOption = app.config.get<MultiWorker["options"]>(
    "resque.multiWorkerOption",
  );
  return reportErrors(
    new MultiWorker(
      {
        queues,
        connection: getConnection(),
        ...multiWorkerOption,
      },
      jobs,
    ),
    "multiWorker",
  );
}

export function isMultiWorkerEnabled() {
  return app.config.get<boolean>("resque.isMultiWorkerEnabled");
}
