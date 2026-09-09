import 'server-only';

import { obligations } from '@app/database/schema';
import { sql } from 'drizzle-orm';

/**
 * Commitments whose current occurrence has *not* already been paid.
 *
 * Every screen that counts what a household owes has to ask this, and asking it
 * four slightly different ways is how two screens end up printing two different
 * totals under the same word. One predicate, imported everywhere.
 *
 * A recurring commitment is rolled forward when it is settled, so its new due
 * date has no settlement row and this passes it straight through. The predicate
 * earns its keep on the one-off: a commitment with no frequency has no next
 * occurrence to move to, and without this it would go on claiming money that
 * already left the account. It is also what makes settling twice harmless.
 */
export const currentOccurrenceUnpaid = sql`not exists (
  select 1
    from app.commitment_settlements s
   where s.obligation_id = ${obligations.id}
     and s.due_on = ${obligations.dueDate}
)`;
