# Changelog

## 3.1.0 (2026-11-13)

### Read first

- **`getConnection()` returns a new shape:** it is public through `@dirupt/adonis-resque/services/main`. It now carries `namespace: "<keyPrefix>resque"`, and its `options` no longer hold `keyPrefix`: the prefix moved from ioredis to node-resque's namespace. A node-resque instance built from it gets the right keys, as before. Code that read `options.keyPrefix` must read the prefix from the application's redis config instead.
- **Redis errors no longer kill the process:** an `error` event of the Queue, the Worker, the MultiWorker or the Scheduler the package builds is logged (through the `logger` config key) and emitted as the AdonisJS event `resque:error`. Before, an `error` event without a listener threw, so the first Redis error of a failover exited the worker, the scheduler and any process that had enqueued a job. A deployment that relied on that crash and a restart to recover now keeps running while node-resque reconnects: alert on `resque:error` or on the `resque <source> error` log lines instead of on restarts.

### Fixed

- The package loads with node-resque 9.6 and later on every supported Node. node-resque is read through its default import, so Node 22 and Node 24 before 24.15 no longer fail with `does not provide an export named 'Plugins'`.
- An ioredis `keyPrefix` is honoured by every node-resque read. `queue.timestamps()`, `queue.locks()`, `queue.stats()` and the scheduler's stuck worker sweep used to SCAN without the prefix and find nothing. Key names are unchanged byte for byte, no data migration is needed. With an empty `keyPrefix` nothing changes.
- A worker the MultiWorker ends in the middle of `checkQueues()` stays stopped, instead of re-arming itself and polling a closed connection until the process exits (actionhero/node-resque#1346).
- A worker whose queue listing fails reports an `error` event and keeps polling, instead of stopping for good.
- A failed MultiWorker pool check reports an `error` event and the next check still runs, instead of an unhandled rejection and a pool that never resizes again.
- Shutdown no longer resolves the `queue` singleton just to end it, which opened a Redis connection and, with Redis down, failed and leaked a reconnecting client.

### Added

- The AdonisJS event `resque:error` and its payload type `ResqueError` (`source`, `error`, `workerId?`, `queue?`, `job?`).

### Changed

- node-resque is declared as `>=9.3.5 <9.8.0` (was `^9.3.5`), the releases the worker fixes are proven against. Fresh installs resolve 9.7.1. Outside that range, under an override for instance, the worker fixes are not applied and a warning `ADONIS_RESQUE_UNGUARDED_NODE_RESQUE` is printed at startup.
- The worker fixes patch node-resque's `Worker` and `MultiWorker` prototypes once per process, so they also cover instances an application builds itself from the re-exported classes. An application that patched `end`, `track`, `pause`, `poll` or `checkWrapper` itself should drop those patches when it upgrades.

### Upgrading with a `keyPrefix`

Worker ping keys have no expiry, and the stuck worker sweep never saw them under a prefix. Every worker that died without ending (killed, out of memory, evicted) left one behind. On the first sweep after the upgrade, the scheduler cleans each worker whose ping is older than `stuckWorkerTimeout` (1 hour by default): `stat:failed` is incremented, and a job it was working on goes to the failed list. To know how many to expect, count them first, with the connection options of your Redis:

```bash
redis-cli --scan --pattern '<keyPrefix>resque:worker:ping:*' | wc -l
```

## 3.0.0

- Fork of [`adonis-resque`](https://github.com/shiny/adonis-resque) published as `@dirupt/adonis-resque`, with AdonisJS 7 support. Requires Node 24 or later, `@adonisjs/core` 7 and `@adonisjs/redis` 9.
