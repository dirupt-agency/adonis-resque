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

## License

[MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/@dirupt/adonis-resque?logo=npm&style=for-the-badge
[npm-url]: https://www.npmjs.com/package/@dirupt/adonis-resque

[license-image]: https://img.shields.io/npm/l/@dirupt/adonis-resque?style=for-the-badge&color=blueviolet
[license-url]: https://github.com/dirupt-agency/adonis-resque/blob/master/LICENSE

[typescript-image]: https://img.shields.io/npm/types/@dirupt/adonis-resque?color=294E80&label=%20&logo=typescript&style=for-the-badge
[typescript-url]: https://github.com/dirupt
