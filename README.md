# @dirupt/adonis-resque

> Fork of [adonis-resque](https://github.com/shiny/adonis-resque) with AdonisJS v7 support

[![npm-image]][npm-url] [![license-image]][license-url] [![typescript-image]][typescript-url]

Resque queue system for AdonisJS, powered by [node-resque](https://github.com/actionhero/node-resque).

## Credits

This package is a fork of [`adonis-resque`](https://github.com/shiny/adonis-resque) by [Dai Jie](https://github.com/shiny), updated for AdonisJS v7 compatibility. All credit for the original implementation goes to the original author.

## Versions

| @dirupt/adonis-resque | @adonisjs/core | @adonisjs/redis |
|-----------------------|----------------|-----------------|
| ^3.\*.\*              | ^7.\*.\*       | ^9.\*.\*        |

For AdonisJS v6, use the original package: [`adonis-resque@^2`](https://github.com/shiny/adonis-resque)

## Installation

```bash
pnpm add @dirupt/adonis-resque
```

After install call `configure`:

```bash
node ace configure @dirupt/adonis-resque
```

This will:
- Create `config/resque.ts` with default configuration
- Register the provider and commands in `adonisrc.ts`

## Usage

Make sure `@adonisjs/redis` is installed and configured before using this package.

### Creating a Job

```bash
node ace make:job send_email
```

This creates `app/jobs/send_email.ts`:

```ts
import { BaseJob } from '@dirupt/adonis-resque'

export default class SendEmail extends BaseJob {
  async perform(email: string, subject: string) {
    // Your job logic here
  }
}
```

### Enqueueing Jobs

```ts
import SendEmail from '#jobs/send_email'

// Enqueue immediately
await SendEmail.enqueue('user@example.com', 'Welcome!')

// Enqueue with delay (in ms)
await SendEmail.enqueueIn(5000, 'user@example.com', 'Reminder')

// Enqueue at specific time (unix timestamp in ms)
await SendEmail.enqueueAt(Date.now() + 60000, 'user@example.com', 'Scheduled')

// Batch enqueue
await SendEmail.enqueueAll([
  ['user1@example.com', 'Hello'],
  ['user2@example.com', 'Hello'],
])
```

### Scheduling Jobs (Cron / Interval)

```ts
import { BaseJob } from '@dirupt/adonis-resque'

export default class CleanupJob extends BaseJob {
  // Run every hour
  cron = '0 * * * *'

  // Or use interval (e.g., every 5 minutes)
  // interval = '5m'

  async perform() {
    // Cleanup logic
  }
}
```

### Plugins

```ts
import { BaseJob, Plugin } from '@dirupt/adonis-resque'

export default class UniqueJob extends BaseJob {
  plugins = [
    Plugin.jobLock({ lockTimeout: 3600 }),
    Plugin.retry({ retryLimit: 3, retryDelay: 1000 }),
  ]

  async perform() {
    // Job logic
  }
}
```

Available plugins:
- `Plugin.jobLock()` - Prevent duplicate running jobs
- `Plugin.queueLock()` - Prevent duplicate queued jobs
- `Plugin.delayQueueLock()` - Prevent duplicate delayed jobs
- `Plugin.retry()` - Retry failed jobs
- `Plugin.noop()` - Log errors without throwing

### Starting Workers

```bash
# Start workers (default)
node ace resque:start

# Start scheduler only
node ace resque:start --schedule

# Use multi-worker
node ace resque:start --isMulti

# Specify queue names
node ace resque:start --queueName=high --queueName=default
```

### Configuration

In `config/resque.ts`:

```ts
import { defineConfig } from '@dirupt/adonis-resque'

const resqueConfig = defineConfig({
  redisConnection: 'main',
  runWorkerInWebEnv: true,
  runScheduler: true,
  isMultiWorkerEnabled: true,
  multiWorkerOption: {
    minTaskProcessors: 1,
    maxTaskProcessors: 10,
  },
  workerOption: {},
  queueNameForJobs: 'default',
  queueNameForWorkers: '*',
  logger: null,
  verbose: true,
})

export default resqueConfig
```

### Error Handling

Override `handleError` in your job class:

```ts
export default class MyJob extends BaseJob {
  handleError(error: unknown) {
    // Custom error handling
    console.error('Job failed:', error)
    throw error // Re-throw to mark as failed
  }

  onFailure(failure: ResqueFailure) {
    // Called when the job fails after all retries
  }
}
```

## Development

The test suite runs against a real Redis, under 2 profiles: an ioredis `keyPrefix`, and a Redis user whose ACL is restricted to that prefix.

```bash
pnpm install
pnpm test        # lint, then the suite with coverage
pnpm quick:test  # the suite only

# the suite against the other node-resque releases the package admits, installed under npm aliases
pnpm test:node-resque:9.3.5
pnpm test:node-resque:9.4.0
pnpm test:node-resque:9.5.2
pnpm test:matrix   # the locked release (9.7.1), then the 3 above
```

Each run prints the node-resque release it actually loaded. `NODE_RESQUE_VERSION` selects it, through a resolve hook registered first by `bin/test.ts`. Without it, the locked release is used.

### node-resque releases

The package patches 3 defects of node-resque's Worker and MultiWorker (see `node_resque_guards.ts`), so it only admits the releases those patches are proven against: `dependencies` declares `>=9.3.5 <9.8.0`, and `GUARDED_RANGE` carries the same bounds (a test fails when they differ). Outside that range, under an override for instance, the patches are not applied and a `ADONIS_RESQUE_UNGUARDED_NODE_RESQUE` warning says so at startup.

A new node-resque minor enters only with its alias in the test matrix, a green `pnpm test:matrix`, and both ranges moved together. If that release fixes the defects upstream, drop the guards instead of widening them.

Without `REDIS_HOST`, `bin/test.ts` starts a throwaway `redis:7-alpine` container (Docker required, labelled `adonis-resque-test=1`) and stops it when the suite ends. To run against a Redis you already have, set `REDIS_HOST`, `REDIS_PORT` and, if the default user has one, `REDIS_PASSWORD`. The suite then only touches keys under the `artest:` prefix, and creates then deletes one ACL user, `artest`. The suite fails if Redis does not answer within 15 seconds.

### Releasing

`.github/workflows/ci.yml` runs lint, typecheck, build and `pnpm test:matrix` against a Redis service on every push and pull request, and checks that the built package loads on Node 24.13. On a `v*` tag, once those pass, it publishes to npm through trusted publishing, with provenance and no token. A prerelease version goes under the `next` dist-tag.

From a clean, up-to-date `v2`, with the version heading of `CHANGELOG.md` dated:

```bash
pnpm exec np 3.1.0-rc.0 --preview   # dry run
pnpm exec np 3.1.0-rc.0             # bump, commit "chore(release): ...", tag, push
```

`np` never publishes here (`np.publish: false`): the pushed tag does, through CI.

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/@dirupt/adonis-resque?logo=npm&style=for-the-badge
[npm-url]: https://www.npmjs.com/package/@dirupt/adonis-resque

[license-image]: https://img.shields.io/npm/l/@dirupt/adonis-resque?style=for-the-badge&color=blueviolet
[license-url]: https://github.com/dirupt-agency/adonis-resque/blob/master/LICENSE

[typescript-image]: https://img.shields.io/npm/types/@dirupt/adonis-resque?color=294E80&label=%20&logo=typescript&style=for-the-badge
[typescript-url]: https://github.com/dirupt
