/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from "@japa/runner";
import { randomUUID } from "node:crypto";
import {
  PROFILES,
  adminClient,
  clientFor,
  clearPrefix,
} from "./helpers/redis.js";
import { bootTestApp, workOne } from "./helpers/app.js";
import RecordJob from "./fixtures/app/app/jobs/record_job.js";

test.group("smoke: enqueue, work, read back", (group) => {
  group.each.setup(async () => {
    await clearPrefix();
  });

  for (const profile of Object.values(PROFILES)) {
    test(
      "a job enqueued through BaseJob is performed under the {$self} profile",
    )
      .with([profile.name])
      .run(async ({ expect, cleanup }) => {
        const app = await bootTestApp(profile);
        cleanup(() => app.terminate());

        const token = randomUUID();
        await RecordJob.enqueue(token);

        const performed = await workOne();

        expect(performed).toEqual({ job: "RecordJob", result: token });
      });
  }
});

test.group("ACL profile", () => {
  test("refuses a write outside the key prefix", async ({
    expect,
    cleanup,
  }) => {
    const redis = clientFor(PROFILES.acl, { keyPrefix: "" });
    cleanup(async () => {
      await redis.quit();
    });

    await expect(redis.set("outside-the-prefix", "1")).rejects.toThrow(
      /NOPERM/,
    );
  });

  test("accepts a write inside the key prefix", async ({ expect, cleanup }) => {
    const redis = clientFor(PROFILES.acl);
    const admin = adminClient();
    cleanup(async () => {
      await redis.quit();
      await admin.quit();
    });

    await redis.set("inside", "1");

    expect(await admin.get(`${PROFILES.acl.keyPrefix}inside`)).toBe("1");
  });
});
