/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { IgnitorFactory } from "@adonisjs/core/factories";
import type { ApplicationService } from "@adonisjs/core/types";
import { type ParsedJob } from "node-resque";
import { defineConfig } from "../../define_config.js";
import { importAllJobs } from "../../jobs.js";
import { createWorker } from "../../services/main.js";
import { connectionOptions, type RedisProfile } from "./redis.js";

export const FIXTURE_ROOT = new URL("../fixtures/app/", import.meta.url);

/**
 * Boots a minimal AdonisJS application whose `main` Redis connection follows the profile, with
 * the resque provider registered and the jobs of `tests/fixtures/app/app/jobs`. Nothing runs in
 * the background: workers are started by the test itself.
 */
export async function bootTestApp(
  profile: RedisProfile,
  connectionOverrides: Record<string, unknown> = {},
): Promise<ApplicationService> {
  const ignitor = new IgnitorFactory()
    .merge({
      rcFileContents: {
        providers: [() => import("../../providers/resque_provider.js")],
      },
      config: {
        redis: {
          connection: "main",
          connections: {
            main: { ...connectionOptions(profile), ...connectionOverrides },
          },
        },
        resque: defineConfig({
          redisConnection: "main",
          runWorkerInWebEnv: false,
          runScheduler: false,
          isMultiWorkerEnabled: false,
          multiWorkerOption: {},
          workerOption: { timeout: 50 },
          queueNameForJobs: "default",
          queueNameForWorkers: "default",
          logger: null,
          verbose: false,
        }),
      },
    })
    .withCoreConfig()
    .withCoreProviders()
    .create(FIXTURE_ROOT, {
      importer: (filePath) => import(new URL(filePath, FIXTURE_ROOT).href),
    });

  const app = ignitor.createApp("test");
  await app.init();
  await app.boot();
  return app as ApplicationService;
}

/**
 * Starts one worker on the `default` queue, waits for the first job it completes, and ends it.
 */
export async function workOne(
  timeoutMs = 5_000,
): Promise<{ job: string; result: unknown }> {
  const jobs = await importAllJobs();
  const worker = createWorker(jobs, ["default"]);

  try {
    const done = new Promise<{ job: string; result: unknown }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no job completed within ${timeoutMs}ms`)),
          timeoutMs,
        );
        worker.on(
          "success",
          (_queue: string, job: ParsedJob, result: unknown) => {
            clearTimeout(timer);
            resolve({ job: job.class, result });
          },
        );
        worker.on(
          "failure",
          (_queue: string, job: ParsedJob, failure: Error) => {
            clearTimeout(timer);
            reject(new Error(`job ${job.class} failed`, { cause: failure }));
          },
        );
        worker.on("error", (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    await worker.connect();
    await worker.start();
    return await done;
  } finally {
    await worker.end();
  }
}
