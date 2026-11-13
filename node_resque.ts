/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * The only module that loads node-resque at runtime. Every other module takes its values from
 * here.
 *
 * node-resque is CommonJS. An ESM `import { Plugins } from "node-resque"` only links when Node's
 * CJS lexer detects the name in the emitted code, and that detection depends on both sides: the
 * TypeScript 6 emit of node-resque 9.6.0 and later hides `Plugins` from the lexer of Node 22 and
 * Node 24 before 24.15, which this package supports. The default import always receives
 * `module.exports`, whatever the Node version or the compiler that built node-resque.
 *
 * Each class is re-exported as a value and as a type, so `Worker` or `Queue` keep working in a
 * type position for consumers, exactly as the former re-exports did.
 */
import { createRequire } from "node:module";
import nodeResque from "node-resque";
import type * as NodeResque from "node-resque";
import { guardNodeResque } from "./node_resque_guards.js";

/**
 * The release actually resolved, read from its own manifest.
 */
export const nodeResqueVersion = (
  createRequire(import.meta.url)("node-resque/package.json") as {
    version: string;
  }
).version;

/**
 * Whether the worker guards of `node_resque_guards.ts` are in place for this release.
 */
export const nodeResqueGuarded = guardNodeResque(nodeResque, nodeResqueVersion);

export const Connection = nodeResque.Connection;
export type Connection = NodeResque.Connection;

export const Queue = nodeResque.Queue;
export type Queue = NodeResque.Queue;

export const Scheduler = nodeResque.Scheduler;
export type Scheduler = NodeResque.Scheduler;

export const Worker = nodeResque.Worker;
export type Worker = NodeResque.Worker;

export const MultiWorker = nodeResque.MultiWorker;
export type MultiWorker = NodeResque.MultiWorker;

export const Plugin = nodeResque.Plugin;
export type Plugin = NodeResque.Plugin;

export const Plugins = nodeResque.Plugins;
