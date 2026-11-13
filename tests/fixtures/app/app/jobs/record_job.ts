/*
 * @dirupt/adonis-resque
 *
 * Fork (c) Dirupt
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import BaseJob from "../../../../../base_job.js";

/**
 * Returns its argument, so a test reads back through the worker's `success` event exactly what
 * it enqueued.
 */
export default class RecordJob extends BaseJob {
  perform(token: string) {
    return token;
  }
}
