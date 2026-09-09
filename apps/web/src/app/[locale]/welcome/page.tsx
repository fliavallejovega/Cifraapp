import { getCurrency, type CurrencyCode } from '@app/domain';
import { PANAMA_2026_DRAFT, payrollReference } from '@app/tax-engine';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthScreen } from '@/components/auth-screen';
import { InviteForm } from '@/components/invite-form';
import { HouseholdForm } from '@/components/household-form';
import { SetupQuestionnaire } from '@/components/setup-questionnaire';
import { formatMoment } from '@/lib/format';
import { isOwner, loadInvitations } from '@/server/repositories/access';
import { loadSetupAnswers } from '@/server/repositories/setup-answers';
import { requireSession } from '@/server/session';

/**
 * First run, in two halves.
 *
 * The first is the household: a name and a currency, because nothing can be
 * created before something owns it. The second is the questionnaire, which is
 * the half that was missing. Every engine in this system reads obligations,
 * debts, goals and a household size, and none of those could be created — so a
 * new household arrived at a plan screen that correctly reported that nothing
 * claimed their money, which is true and useless.
 *
 * Asking is not a delay before the product starts. It is the only way the first
 * screen a person sees can be about their money rather than about ours.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  setRequestLocale(locale);

  const session = await requireSession(locale);

  if (!session.activeHouseholdId) {
    return <HouseholdStep locale={locale} />;
  }

  const householdId = session.activeHouseholdId;
  const answers = await loadSetupAnswers(session, householdId);

  const household = session.households.find((entry) => entry.id === householdId);
  const currency = (household?.baseCurrency.trim() ?? 'USD') as CurrencyCode;
  const t = await getTranslations('setup');

  // Answered before, so this is a review: same six questions, filled in with
  // what is on record. It used to redirect anybody who came back, which made a
  // mistyped salary permanent as far as this screen was concerned — and made a
  // liar of the settings screen, which had been offering to re-open it.
  const review = answers.answered;

  // Las cifras con las que se explica una planilla, leídas aquí porque aquí ya
  // se está en el servidor: la pantalla dibuja la leyenda con ellas sin tener
  // que pedirlas después. `null` cuando al conjunto le falta algo, y entonces no
  // hay leyenda en vez de una leyenda a medias.
  const payroll = payrollReference(PANAMA_2026_DRAFT);

  /**
   * Y con quién se lleva la casa, desde la primera pantalla.
   *
   * Un hogar de una persona es una hoja de cálculo con mejores tipografías. El
   * producto entero se apoya en que sean dos: una cifra que las dos creen, un
   * plan en el que las dos estuvieron de acuerdo. Invitar estaba solo en la
   * pantalla de accesos, a la que nadie llega antes de terminar el setup — y
   * ahora que lo contestado se guarda con el hogar, quien invita puede empezar
   * y quien acepta puede terminar.
   */
  const now = new Date();
  const [owner, invitations] = await Promise.all([
    isOwner(session, householdId),
    loadInvitations(session, householdId, now),
  ]);
  const access = await getTranslations('access');

  /**
   * El bloque de invitación, armado aquí y colocado por la pantalla.
   *
   * Se dibuja en el servidor porque necesita las traducciones y las
   * invitaciones pendientes, y viaja como nodo porque quién lo enseña y cuándo
   * es una decisión del cuestionario: va solo en el primer paso, que es donde
   * se decide quién vive en la casa.
   */
  const invite = owner ? (
    <div className="mt-12 border-t border-[color:var(--color-rule)] pt-8">
      <h2 className="text-base font-medium text-[color:var(--color-ink)]">
        {access('invite.title')}
      </h2>
      <p className="mt-1 mb-4 max-w-[60ch] text-sm text-pretty text-[color:var(--color-ink-secondary)]">
        {access('invite.detail')}
      </p>
      <InviteForm
        locale={locale}
        roles={(['partner', 'member', 'viewer'] as const).map((value) => ({
          value,
          label: access(`roles.${value}`),
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          roleLabel: access(`roles.${invitation.role}`),
          state: invitation.acceptedAt
            ? access('invite.accepted')
            : invitation.isExpired
              ? access('invite.expired')
              : access('invite.expires', {
                  date: formatMoment(
                    invitation.expiresAt,
                    locale,
                    household?.timeZone ?? 'America/Panama',
                  ),
                }),
          isOpen: invitation.acceptedAt === null && !invitation.isExpired,
        }))}
        labels={{
          email: access('invite.email'),
          role: access('invite.role'),
          submit: access('invite.submit'),
          linkTitle: access('invite.linkTitle'),
          linkNote: access('invite.linkNote'),
          pending: access('invite.pending'),
          none: access('invite.none'),
          cancel: access('invite.cancel'),
          cancelConfirm: access('invite.cancelConfirm'),
          dismiss: access('members.revoke'),
          errorTitle: access('errorTitle'),
          errors: {
            notAllowed: access('errors.notAllowed'),
            emailInvalid: access('errors.emailInvalid'),
            alreadyMember: access('errors.alreadyMember'),
            cannotChangeOwner: access('errors.cannotChangeOwner'),
            cannotRemoveOwner: access('errors.cannotRemoveOwner'),
            cannotRemoveSelf: access('errors.cannotRemoveSelf'),
            notFound: access('errors.notFound'),
            signInRequired: access('errors.signInRequired'),
            generic: access('errors.generic'),
          },
        }}
      />
    </div>
  ) : null;

  return (
    <AuthScreen
      title={review ? t('review.title') : t('title')}
      detail={review ? t('review.detail') : t('detail')}
      wide
    >
      <SetupQuestionnaire
        locale={locale}
        currencySymbol={getCurrency(currency).symbol}
        currencyCode={currency}
        t={labels(rawOf(t))}
        institutions={answers.institutions}
        {...(payroll ? { payroll } : {})}
        {...(answers.draft ? { draft: answers.draft } : {})}
        {...(invite ? { invite } : {})}
        categories={answers.categories}
        initial={answers}
        review={review}
      />
    </AuthScreen>
  );
}

async function HouseholdStep({ locale }: { locale: string }) {
  const t = await getTranslations('onboarding');

  return (
    <AuthScreen title={t('title')} detail={t('detail')}>
      <HouseholdForm
        locale={locale}
        labels={{
          name: t('fields.name'),
          nameHint: t('fields.nameHint'),
          currency: t('fields.currency'),
          submit: t('submit'),
          errorTitle: t('errors.title'),
          errors: {
            householdNameRequired: t('errors.nameRequired'),
            householdCreateFailed: t('errors.createFailed'),
            signInRequired: t('errors.signInRequired'),
            generic: t('errors.createFailed'),
          },
        }}
      />
    </AuthScreen>
  );
}

/**
 * The questionnaire is a client component and cannot reach the catalogue, so
 * every string it needs is resolved here and handed over flat.
 */
function labels(read: (key: string) => string): Record<string, string> {
  const keys = [
    'draft.notice',
    'draft.resumed',
    'draft.resumedBy',
    'draft.discard',
    'draft.account',
    'draft.rent',
    'draft.minimums',
    'draft.other',
    'review.notice',
    'review.finish',
    'savings.institution',
    'savings.institutionHint',
    'savings.institutionNone',
    'savings.rate',
    'savings.rateHint',
    'holdings.title',
    'holdings.detail',
    'holdings.symbol',
    'holdings.symbolHint',
    'holdings.quantity',
    'holdings.quantityHint',
    'holdings.holder',
    'holdings.holderShared',
    'holdings.add',
    'holdings.checking',
    'holdings.quoted',
    'holdings.unknown',
    'holdings.unavailable',
    'holdings.searchPlaceholder',
    'holdings.searching',
    'holdings.searchRecent',
    'holdings.searchCommon',
    'holdings.searchEmpty',
    'holdings.searchEmptyHint',
    'holdings.searchAllTypes',
    'holdings.searchError',
    'holdings.searchErrorHint',
    'holdings.searchRetry',
    'holdings.scopeLabel',
    'holdings.scope.all',
    'holdings.scope.equity',
    'holdings.scope.fund',
    'holdings.scope.crypto',
    'holdings.scope.bond',
    'holdings.scope.other',
    'holdings.kind.equity',
    'holdings.kind.etf',
    'holdings.kind.fund',
    'holdings.kind.crypto',
    'holdings.kind.index',
    'holdings.kind.other',
    'progress',
    'stages.household',
    'stages.income',
    'stages.savings',
    'stages.commitments',
    'stages.debts',
    'stages.goals',
    'next',
    'back',
    'skipStep',
    'finish',
    'remove',
    'edit',
    'saveAndAdd',
    'incomplete',
    'split.title',
    'split.detail',
    'split.share',
    'split.equal',
    'split.mismatch',
    'split.note',
    'done',
    'amount',
    'errorTitle',
    'error.invalid',
    'error.saveFailed',
    'error.signInRequired',
    'error.dependentsExceedMembers',
    'error.generic',
    'household.title',
    'household.detail',
    'household.name',
    'household.nameHint',
    'household.namePlaceholder',
    'household.relationship',
    'household.dependent',
    'household.add',
    'household.relationships.self',
    'household.relationships.partner',
    'household.relationships.child',
    'household.relationships.parent',
    'household.relationships.sibling',
    'household.relationships.other',
    'household.next',
    'income.title',
    'income.detail',
    'income.name',
    'income.namePlaceholder',
    'income.frequency',
    'income.frequencyHint',
    'income.approximate',
    'income.approximateHint',
    'income.add',
    'income.next',
    'savings.title',
    'savings.detail',
    'savings.name',
    'savings.namePlaceholder',
    'savings.type',
    'savings.balance',
    'savings.add',
    'savings.next',
    'commitments.title',
    'commitments.detail',
    'commitments.name',
    'commitments.namePlaceholder',
    'commitments.dueDay',
    'commitments.dueDayHint',
    'commitments.essential',
    'commitments.essentialHint',
    'household.empty',
    'frequency.daily',
    'income.firstDay',
    'income.secondDay',
    'income.daysHint',
    'income.lastDayHint',
    'income.deductionsDetail',
    'income.gross',
    'income.grossHint',
    'income.deductionLabel',
    'income.deductionPlaceholder',
    'income.deductionAmount',
    'income.per.daily',
    'income.per.weekly',
    'income.per.biweekly',
    'income.per.semimonthly',
    'income.per.monthly',
    'income.per.quarterly',
    'income.per.annual',
    'income.deductionWhen',
    'income.deductionWhenDay',
    'income.deductionWhenOn',
    'income.deductionWhenOff',
    'income.netOnDay',
    'income.netUnevenNote',
    'income.addDeduction',
    'income.addFirstDeduction',
    'receivables.title',
    'receivables.detail',
    'receivables.empty',
    'receivables.add',
    'receivables.addFirst',
    'receivables.name',
    'receivables.namePlaceholder',
    'receivables.source',
    'receivables.sourceHint',
    'receivables.sourcePlaceholder',
    'receivables.expectedOn',
    'receivables.expectedOnHint',
    'receivables.confidence',
    'receivables.confidenceHint',
    'receivables.confirmed',
    'receivables.estimated',
    'receivables.totalLabel',
    'receivables.totalNote',
    'income.totalLabel',
    'income.totalNote',
    'income.grossLine',
    'income.annualLine',
    'income.meaningTitle',
    'income.meaningNet',
    'income.meaningNetHint',
    'income.meaningGross',
    'income.meaningGrossHint',
    'income.effectiveSuffix',
    'income.legendShow',
    'income.legendHide',
    'income.legendContributions',
    'income.isrTitle',
    'income.isrIntro',
    'income.isrChartCaption',
    'income.isrBase',
    'income.isrBaseGross',
    'income.isrBaseNet',
    'income.isrEffective',
    'income.legendSource',
    'income.deductedLine',
    'income.netLine',
    'income.estimateAction',
    'income.estimating',
    'income.estimateFailed',
    'income.estimateNote',
    'income.line.socialSecurity',
    'income.line.educationTax',
    'income.line.incomeTax',
    'commitments.frequency',
    'commitments.frequencyHint',
    'commitments.category',
    'commitments.categoryHint',
    'commitments.categoryNone',
    'commitments.paidFrom',
    'commitments.paidFromHint',
    'commitments.paidFromNone',
    'commitments.atSource',
    'commitments.atSourceHint',
    'commitments.firstAmount',
    'commitments.secondAmount',
    'commitments.unevenHint',
    'commitments.totalOptional',
    'commitments.totalAllEssential',
    'commitments.totalTitle',
    'commitments.totalDetail',
    'commitments.totalConverted',
    'commitments.totalYouPay',
    'commitments.totalFromSalary',
    'commitments.totalLabel',
    'commitments.optionalTag',
    'commitments.totalIncome',
    'commitments.totalLeft',
    'commitments.totalLeftNote',
    'commitments.totalFromSalaryNote',
    'commitments.firstDay',
    'commitments.secondDay',
    'commitments.daysHint',
    'commitments.lastDayHint',
    'household.addFirst',
    'income.addFirst',
    'savings.addFirst',
    'commitments.addFirst',
    'debts.addFirst',
    'debts.kind',
    'debts.frequency',
    'debts.frequencyHint',
    'debts.dueDay',
    'debts.dueDayHint',
    'debts.firstDay',
    'debts.secondDay',
    'debts.secondDayHint',
    'debts.repayment',
    'debts.repaymentHint',
    'debts.payroll',
    'debts.payrollHint',
    'debts.repayments.fixed_instalment',
    'debts.repayments.declining_instalment',
    'debts.repayments.interest_only',
    'debts.repayments.single_payment',
    'debts.repayments.no_interest_plan',
    'debts.repayments.revolving',
    'debts.kindHint',
    'debts.term',
    'debts.termHint',
    'debts.paid',
    'debts.paidHint',
    'debts.totalTitle',
    'debts.totalBalance',
    'debts.totalMinimum',
    'debts.totalLeft',
    'debts.totalNote',
    'debts.totalRemaining',
    'debts.kinds.credit_card',
    'debts.kinds.auto_loan',
    'debts.kinds.mortgage',
    'debts.kinds.personal_loan',
    'debts.kinds.student_loan',
    'debts.kinds.other',
    'goals.addFirst',
    'goals.saved',
    'goals.savedHint',
    'goals.committed',
    'goals.committedHint',
    'income.empty',
    'savings.empty',
    'savings.totalTitle',
    'savings.totalDetail',
    'savings.totalAccounts',
    'savings.totalHoldings',
    'savings.totalOtherCurrency',
    'savings.totalLabel',
    'savings.totalUnpriced',
    'commitments.empty',
    'commitments.lateFee',
    'commitments.lateFeeHint',
    'commitments.lateFeeNone',
    'commitments.lateFeeAmount',
    'commitments.lateFeeRate',
    'commitments.lateFeeHowMuch',
    'commitments.lateFeeHowMuchRate',
    'commitments.lateFeeAfter',
    'commitments.lateFeeAfterHint',
    'debts.empty',
    'goals.empty',
    'commitments.add',
    'commitments.next',
    'debts.title',
    'debts.detail',
    'debts.name',
    'debts.namePlaceholder',
    'debts.balance',
    'debts.apr',
    'debts.aprHint',
    'debts.minimum',
    'debts.minimumHint',
    'debts.available',
    'debts.holderShared',
    'debts.holderHint',
    'debts.holder',
    'debts.limitHint',
    'debts.limit',
    'debts.add',
    'debts.next',
    'goals.title',
    'goals.detail',
    'goals.name',
    'goals.namePlaceholder',
    'goals.target',
    'goals.date',
    'goals.dateHint',
    'goals.add',
    'goals.buffer',
    'goals.bufferHint',
    'frequency.weekly',
    'frequency.biweekly',
    'frequency.semimonthly',
    'frequency.monthly',
    'frequency.quarterly',
    'frequency.annual',
    'accountType.checking',
    'accountType.savings',
    'accountType.cash',
    'accountType.digital_wallet',
  ];

  return Object.fromEntries(keys.map((key) => [key, read(key)]));
}

/**
 * A message that carries placeholders filled in the browser, where the value is
 * client state the server never had — a selection count, a running total.
 * `t()` would try to resolve them here and throw; the template has to travel
 * whole.
 */
function rawOf(t: { raw: (key: string) => unknown }): (key: string) => string {
  return (key) => {
    const value = t.raw(key);
    return typeof value === 'string' ? value : '';
  };
}
