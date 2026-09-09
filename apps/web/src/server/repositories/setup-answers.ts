import 'server-only';

import {
  accounts,
  categories,
  debts,
  goals,
  holdings,
  householdPeople,
  householdSettings,
  incomeDeductions,
  institutions,
  marketPrices,
  obligations,
  profiles,
  receivables,
  recurringSeries,
  setupDrafts,
} from '@app/database/schema';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import type { SetupInitial } from '@/components/setup-questionnaire';
import { trimAmount } from '@/lib/format';
import { queryAsUser, type Session } from '../session';

/**
 * What the household already told us, read back in the shape the questionnaire
 * asks it in.
 *
 * The questionnaire used to be a one-way door: answered once, then closed, and
 * `/welcome` bounced anybody who returned. That was wrong in the ordinary way
 * — a person mistypes a salary in the second minute of using a product and has
 * no way back to it — and wrong in a worse way too, because the settings screen
 * had been telling them they could re-answer it. A promise the code did not
 * keep.
 *
 * Reading the answers back is what makes returning a correction rather than a
 * second helping. Every row carries its id, so saving updates what is already
 * there instead of adding a duplicate beside it.
 *
 * Only what the questionnaire itself can express is read. A household that has
 * since imported statements has accounts with real balances and obligations the
 * recurrence engine found; those appear here as rows too, because hiding them
 * would let somebody "correct" their income and unknowingly leave a duplicate
 * of it standing.
 */

/**
 * The questionnaire's own shape, plus whether it has been answered.
 *
 * Typed as the form's `SetupInitial` rather than restated here, so a column
 * added to one of the six questions cannot quietly stop reaching the field
 * that asks about it.
 */
export interface SetupAnswers extends SetupInitial {
  /** Whether the questionnaire has been answered before. Changes every word. */
  readonly answered: boolean;
  /** The banks the accounts step offers, by name. Seeded reference data. */
  readonly institutions: readonly string[];
  /** The household's expense categories, for the «¿en qué rubro?» question. */
  readonly categories: readonly {
    readonly slug: string;
    readonly name: string;
    readonly icon: string | null;
  }[];
  /**
   * El cuestionario que alguien dejó a medias, si lo hay.
   *
   * Del hogar y no del navegador, para que quien lo empezó y quien lo termina
   * no tengan que ser la misma persona en el mismo dispositivo.
   */
  readonly draft:
    { readonly answers: unknown; readonly step: number; readonly by: string | null } | undefined;
}

export async function loadSetupAnswers(
  session: Session,
  householdId: string,
): Promise<SetupAnswers> {
  return queryAsUser(session, async (tx) => {
    const [
      settings,
      peopleRows,
      accountRows,
      incomeRows,
      commitmentRows,
      debtRows,
      holdingRows,
      goalRows,
      bankRows,
      categoryRows,
      deductionRows,
      receivableRows,
      draftRows,
    ] = await Promise.all([
      tx
        .select({
          buffer: householdSettings.bufferMinimum,
          completedAt: householdSettings.onboardingCompletedAt,
        })
        .from(householdSettings)
        .where(eq(householdSettings.householdId, householdId))
        .limit(1),
      tx
        .select({
          id: householdPeople.id,
          name: householdPeople.displayName,
          relationship: householdPeople.relationship,
          isDependent: householdPeople.isDependent,
          expenseShare: householdPeople.expenseShare,
        })
        .from(householdPeople)
        .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)))
        .orderBy(asc(householdPeople.createdAt)),
      tx
        .select({
          id: accounts.id,
          name: accounts.name,
          accountType: accounts.accountType,
          balance: accounts.currentBalance,
          institution: institutions.name,
          interestRate: accounts.interestRate,
        })
        .from(accounts)
        .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
        // Cards excluded: the questionnaire asks about them on the debts
        // step, where the limit and the holder are. Including one here sent
        // `credit_card` to a field whose options are the four kinds of
        // account you can hold money in, and the whole answer set was
        // rejected as invalid — a save that failed with a message about
        // amounts, on a form where nothing was wrong with the amounts.
        .where(
          and(
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
            eq(accounts.status, 'active'),
            ne(accounts.accountType, 'credit_card'),
          ),
        )
        .orderBy(asc(accounts.createdAt)),
      tx
        .select({
          id: recurringSeries.id,
          name: recurringSeries.name,
          amount: recurringSeries.expectedAmount,
          frequency: recurringSeries.frequency,
          anchorDays: recurringSeries.anchorDays,
          grossAmount: recurringSeries.grossAmount,
          variation: recurringSeries.amountVariation,
        })
        .from(recurringSeries)
        .where(
          and(
            and(eq(recurringSeries.householdId, householdId), isNull(recurringSeries.deletedAt)),
            eq(recurringSeries.direction, 'inflow'),
            eq(recurringSeries.isActive, true),
          ),
        )
        .orderBy(asc(recurringSeries.createdAt)),
      tx
        .select({
          id: obligations.id,
          name: obligations.name,
          amount: obligations.expectedAmount,
          dueDate: obligations.dueDate,
          isEssential: obligations.isEssential,
          paidFromSeriesId: obligations.paidFromSeriesId,
          isDeductedAtSource: obligations.isDeductedAtSource,
          anchorAmounts: obligations.anchorAmounts,
          categorySlug: categories.templateSlug,
          lateFeeAmount: obligations.lateFeeAmount,
          lateFeeRate: obligations.lateFeeRate,
          lateFeeAfterDays: obligations.lateFeeAfterDays,
          frequency: obligations.frequency,
          anchorDays: obligations.anchorDays,
        })
        .from(obligations)
        .leftJoin(categories, eq(categories.id, obligations.categoryId))
        .where(and(eq(obligations.householdId, householdId), isNull(obligations.deletedAt)))
        .orderBy(asc(obligations.createdAt)),
      // The card behind a debt, when there is one, is where the limit and
      // the holder live — so the questionnaire can show them back.
      tx
        .select({
          id: debts.id,
          name: debts.name,
          balance: debts.currentBalance,
          apr: debts.apr,
          minimumPayment: debts.minimumPayment,
          creditLimit: debts.creditLimit,
          personName: householdPeople.displayName,
        })
        .from(debts)
        .leftJoin(accounts, eq(accounts.id, debts.accountId))
        .leftJoin(householdPeople, eq(householdPeople.id, accounts.personId))
        .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt)))
        .orderBy(asc(debts.createdAt)),
      tx
        .select({
          id: holdings.id,
          symbol: holdings.symbol,
          label: holdings.label,
          quantity: holdings.quantity,
          personName: householdPeople.displayName,
          price: marketPrices.price,
          currency: marketPrices.currency,
          displayName: marketPrices.displayName,
          kind: marketPrices.kind,
        })
        .from(holdings)
        .leftJoin(householdPeople, eq(householdPeople.id, holdings.personId))
        .leftJoin(marketPrices, eq(marketPrices.symbol, holdings.symbol))
        .where(and(eq(holdings.householdId, householdId), isNull(holdings.deletedAt)))
        .orderBy(asc(holdings.createdAt)),
      tx
        .select({
          id: goals.id,
          name: goals.name,
          targetAmount: goals.targetAmount,
          targetDate: goals.targetDate,
          currentAmount: goals.currentAmount,
          isCommitted: goals.isCommitted,
          status: goals.status,
        })
        .from(goals)
        .where(and(eq(goals.householdId, householdId), eq(goals.status, 'active')))
        .orderBy(asc(goals.priority)),
      // Reference data, the same for everybody. Read here so the accounts
      // step can offer a list rather than a free-text field that spells the
      // same bank four ways across four households.
      tx
        .select({ name: institutions.name })
        .from(institutions)
        .where(eq(institutions.country, 'PA'))
        .orderBy(asc(institutions.name)),
      // The household's own expense categories, so the questionnaire can ask
      // «¿en qué rubro va esto?» with the same list every other screen uses
      // rather than a second, private one that would drift.
      tx
        .select({ slug: categories.templateSlug, name: categories.name, icon: categories.icon })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.kind, 'expense'),
            isNull(categories.archivedAt),
          ),
        )
        .orderBy(asc(categories.sortOrder)),
      // Las líneas del recibo, para que una segunda visita muestre el mismo
      // desglose que se copió la primera vez en vez de un bruto sin explicar.
      tx
        .select({
          seriesId: incomeDeductions.seriesId,
          label: incomeDeductions.label,
          amount: incomeDeductions.amount,
          appliesToAnchors: incomeDeductions.appliesToAnchors,
          ruleKey: incomeDeductions.ruleKey,
        })
        .from(incomeDeductions)
        .where(eq(incomeDeductions.householdId, householdId))
        .orderBy(asc(incomeDeductions.sortOrder)),
      // Lo que está por cobrar, para que una segunda visita muestre la misma
      // lista. Lo ya cobrado queda fuera: el cuestionario pregunta por lo que
      // viene, no por lo que llegó.
      tx
        .select({
          id: receivables.id,
          name: receivables.name,
          source: receivables.source,
          amount: receivables.amount,
          expectedOn: receivables.expectedOn,
          confidence: receivables.confidence,
        })
        .from(receivables)
        .where(
          and(
            eq(receivables.householdId, householdId),
            isNull(receivables.deletedAt),
            isNull(receivables.receivedOn),
          ),
        )
        .orderBy(asc(receivables.expectedOn)),
      // Y lo que alguien dejó a medias, con su nombre: retomar el trabajo de
      // otra persona sin saber de quién es se parece demasiado a encontrarse
      // cifras que uno no escribió.
      tx
        .select({
          answers: setupDrafts.answers,
          step: setupDrafts.step,
          by: profiles.displayName,
          byId: setupDrafts.updatedBy,
        })
        .from(setupDrafts)
        .leftJoin(profiles, eq(profiles.id, setupDrafts.updatedBy))
        .where(eq(setupDrafts.householdId, householdId))
        .limit(1),
    ]);

    return {
      people: peopleRows.map((row) => ({
        id: row.id,
        name: row.name,
        relationship: row.relationship,
        isDependent: row.isDependent,
        // Sin decimales de relleno: «50» y no «50.00», que es como alguien
        // escribe un porcentaje y como lo va a volver a ver.
        expenseShare: row.expenseShare ? trimAmount(row.expenseShare) : '',
      })),
      accounts: accountRows.map((row) => ({
        id: row.id,
        name: row.name,
        accountType: row.accountType as SetupInitial['accounts'][number]['accountType'],
        balance: trimAmount(row.balance),
        institution: row.institution ?? '',
        interestRate: row.interestRate ? trimAmount(row.interestRate) : '',
      })),
      incomes: incomeRows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: trimAmount(row.amount),
        frequency: row.frequency,
        // The variation is how "about 2,400" was recorded. Reading it back as
        // the checkbox keeps the two descriptions of one claim in step.
        isApproximate: Number(row.variation) > 0,
        // Back into the two fields they were typed in, so a household that
        // said «el 5 y el 20» sees that on a second visit rather than a blank
        // pair of boxes that would silently become an approximation on save.
        anchorFirst: row.anchorDays?.[0] === undefined ? '' : String(row.anchorDays[0]),
        anchorSecond: row.anchorDays?.[1] === undefined ? '' : String(row.anchorDays[1]),
        grossAmount: row.grossAmount ? trimAmount(row.grossAmount) : '',
        deductions: deductionRows
          .filter((line) => line.seriesId === row.id)
          .map((line) => ({
            label: line.label,
            amount: trimAmount(line.amount),
            // Nulo es «en todos los pagos». Se devuelve como lista vacía porque
            // es lo que el formulario entiende, y las dos cosas significan lo
            // mismo: ningún día en particular.
            appliesToAnchors: line.appliesToAnchors ?? [],
            // Se reabre sabiendo cuáles calculó el motor, para que esas sigan
            // sin ofrecer una pregunta que no tienen.
            ...(line.ruleKey ? { ruleKey: line.ruleKey } : {}),
          })),
      })),
      commitments: commitmentRows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: trimAmount(row.amount),
        // The questionnaire asks for a day of the month; the obligation stores
        // a date. The day is the part the person chose.
        dueDay: String(Number(row.dueDate.slice(8, 10))),
        isEssential: row.isEssential,
        // Stored as the income's id, answered as its position in the list. An
        // income deleted since drops the pointer rather than leaving a stale
        // index, so a review shows «lo pago yo» instead of silently pointing
        // the payment at whichever salary now happens to sit in that slot.
        ...(() => {
          const at = incomeRows.findIndex((income) => income.id === row.paidFromSeriesId);
          return row.paidFromSeriesId && at >= 0 ? { paidFromIncome: at } : {};
        })(),
        isDeductedAtSource: row.isDeductedAtSource,
        categorySlug: row.categorySlug ?? '',
        // Back into the two amount fields they were typed in. Blank when the
        // fortnights are even, which is what an empty second field means.
        anchorFirstAmount:
          row.anchorAmounts?.[0] === undefined ? '' : trimAmount(row.anchorAmounts[0]),
        anchorSecondAmount:
          row.anchorAmounts?.[1] === undefined ? '' : trimAmount(row.anchorAmounts[1]),
        // Read back as the shape it was answered in. Which column holds a
        // figure is what says whether the contract charges a sum or a share.
        lateFeeKind: row.lateFeeAmount
          ? ('amount' as const)
          : row.lateFeeRate
            ? ('rate' as const)
            : ('none' as const),
        lateFee: trimAmount(row.lateFeeAmount ?? row.lateFeeRate ?? ''),
        lateFeeAfterDays: row.lateFeeAfterDays === null ? '' : String(row.lateFeeAfterDays),
        frequency: (row.frequency ?? 'monthly') as SetupInitial['commitments'][number]['frequency'],
        anchorFirst: row.anchorDays?.[0] === undefined ? '' : String(row.anchorDays[0]),
        anchorSecond: row.anchorDays?.[1] === undefined ? '' : String(row.anchorDays[1]),
      })),
      debts: debtRows.map((row) => ({
        id: row.id,
        name: row.name,
        balance: trimAmount(row.balance),
        apr: trimAmount(row.apr),
        minimumPayment: trimAmount(row.minimumPayment),
        creditLimit: row.creditLimit ? trimAmount(row.creditLimit) : '',
        personName: row.personName ?? '',
      })),
      goals: goalRows.map((row) => ({
        id: row.id,
        name: row.name,
        targetAmount: trimAmount(row.targetAmount),
        targetDate: row.targetDate ?? '',
        currentAmount: trimAmount(row.currentAmount),
        isCommitted: row.isCommitted,
      })),
      holdings: holdingRows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        label: row.label,
        quantity: trimAmount(row.quantity),
        personName: row.personName ?? '',
        // Shown back as it was last quoted, so a review does not appear to
        // have lost the price — and re-checked on blur like any other row.
        ...(row.price && row.currency
          ? {
              quoted: {
                name: row.displayName ?? row.label,
                price: row.price,
                currency: row.currency,
                kind: row.kind ?? 'other',
              },
              status: 'ok' as const,
            }
          : {}),
      })),
      bufferMinimum: settings[0]?.buffer ? trimAmount(settings[0].buffer) : '',
      answered: Boolean(settings[0]?.completedAt),
      institutions: bankRows.map((row) => row.name),
      // A category with no template slug is one the household invented; it is
      // still theirs to pick, and its own name is the stable handle for it.
      categories: categoryRows.map((row) => ({
        slug: row.slug ?? row.name,
        name: row.name,
        icon: row.icon,
      })),
      receivables: receivableRows.map((row) => ({
        id: row.id,
        name: row.name,
        source: row.source ?? '',
        amount: trimAmount(row.amount),
        expectedOn: row.expectedOn ?? '',
        confidence: row.confidence,
      })),
      draft: draftRows[0]
        ? {
            answers: draftRows[0].answers,
            step: draftRows[0].step,
            // Nombrar a quien lo dejó solo cuando no es quien está mirando.
            // «Seguimos donde lo dejó Javier Vallejo», dicho a Javier Vallejo,
            // suena a que hubo alguien más metido en sus finanzas.
            by: draftRows[0].byId === session.profile.id ? null : draftRows[0].by,
          }
        : undefined,
    };
  });
}
