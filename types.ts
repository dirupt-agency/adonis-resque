/*
 * @dirupt/adonis-resque
 *
 * Original work (c) Dai Jie <https://github.com/shiny>
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

export { Worker, Plugins, Scheduler, Queue } from "./node_resque.js";
export type { RedisConnections } from "@adonisjs/redis/types";
import { type Plugin } from "node-resque";
import type BaseJob from "./base_job.js";
import { type defineConfig } from "./define_config.js";
export type ResqueConfig = ReturnType<typeof defineConfig>;

export interface NodeResqueJob {
  perform(..._args: any[]): any;
  job: BaseJob;
  plugins: (typeof Plugin)[];
  pluginOptions: Record<string, any>;
  args?: any[];
}
export interface JobSchedule {
  interval?: string | number;
  cron?: string;
}

export interface ResqueFailure {
  workerId?: number;
  queue: string;
  job: NodeResqueJob;
  failure: Error;
  duration: number;
  args: any[];
  pluginOptions?: Record<string, any>;
}
/**
 * An `error` event of a node-resque instance the package built, see `errors.ts`.
 */
export interface ResqueError {
  source: "queue" | "worker" | "multiWorker" | "scheduler";
  error: unknown;
  workerId?: number;
  queue?: string;
  job?: unknown;
}
declare module "@adonisjs/core/types" {
  interface EventsList {
    "resque:failure": ResqueFailure;
    "resque:error": ResqueError;
  }
}
