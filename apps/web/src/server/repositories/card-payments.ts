import 'server-only';

import { Money } from '@app/domain';
import { cardPaymentDigits } from '@app/transaction-engine';
import { sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Payments to a card that the books cannot place yet.
 *
 * «PAGO VISA 4468» leaves the savings account, and none of the household's
 * cards ends in 4468 — because the bank printed the first four digits and the
 * household stored the last four. Saved as it is, every one of those lines is
 * an expense, and the card's debt never goes down. So before saving, each set
 * of unknown digits is shown with what it adds up to, to be linked to a card
 * already registered or to a new one.
 */

export interface UnmatchedCardPayment {
  readonly digits: string;
  /** «BANCA MOVIL PAGO VISA 4468-...», as the bank printed one of them. */
  readonly example: string;
  readonly count: number;
  /** Signed decimal string, negative. */
  readonly total: string;
  readonly currency: string;
}

export interface LinkableCard {
  readonly accountId: string;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly network: string | null;
}

export async function loadCardPaymentsToLink(
  session: Session,
  householdId: string,
): Promise<{
  readonly unmatched: readonly UnmatchedCardPayment[];
  readonly cards: readonly LinkableCard[];
}> {
  return queryAsUser(session, async (tx) => {
    const cards = await tx.execute<{
      id: string;
      name: string;
      masked_number: string | null;
      card_network: string | null;
      card_alias_digits: string[];
    }>(sql`
      select a.id, a.name, a.masked_number, a.card_network, a.card_alias_digits
        from app.accounts a
       where a.household_id = ${householdId}
         and a.account_type = 'credit_card'
         and a.deleted_at is null
         and a.status = 'active'
       order by a.name
    `);

    const known = new Set(
      cards
        .flatMap((card) => [card.masked_number ?? '', ...card.card_alias_digits])
        .filter(Boolean),
    );

    const lines = await tx.execute<{ description: string; amount: string; currency: string }>(sql`
      select r.description_original as description, r.amount::text as amount, a.currency
        from app.import_rows r
        join app.imports i on i.id = r.import_id
        join app.accounts a on a.id = i.account_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.verdict = 'new'
         and r.created_transaction_id is null
         and r.apply_to_debt_id is null
         and r.amount < 0
         and r.description_original ~* 'pago'
    `);

    const groups = new Map<string, { example: string; count: number; total: Money }>();
    for (const line of lines) {
      const digits = cardPaymentDigits(line.description);
      if (!digits || known.has(digits)) continue;
      const currency = line.currency.trim() === 'PAB' ? 'PAB' : 'USD';
      const amount = Money.fromDecimalString(line.amount, currency);
      const group = groups.get(digits);
      groups.set(
        digits,
        group
          ? { ...group, count: group.count + 1, total: group.total.add(amount) }
          : { example: line.description, count: 1, total: amount },
      );
    }

    return {
      unmatched: [...groups].map(([digits, group]) => ({
        digits,
        example: group.example,
        count: group.count,
        total: group.total.toDecimalString(),
        currency: group.total.currency,
      })),
      cards: cards.map((card) => ({
        accountId: card.id,
        name: card.name,
        maskedNumber: card.masked_number,
        network: card.card_network,
      })),
    };
  });
}
