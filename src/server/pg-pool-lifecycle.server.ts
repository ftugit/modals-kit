import { attachDatabasePool } from '@vercel/functions'
import type { Pool } from 'pg'

/** Keep idle timers alive through Fluid Compute suspension. This does not
 * close in-use connections or guarantee completion of all request effects. */
export function attachVercelPoolLifecycle(pool: Pool, onVercel: boolean): void {
  if (onVercel) attachDatabasePool(pool)
}
