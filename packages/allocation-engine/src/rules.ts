import { Money } from '@app/domain';
import type { Action, AllocationPriority } from '@app/rule-engine';

import { DEFAULT_PRIORITY_ORDER, type Claim, type ClaimKind, type TargetRef } from './types.js';

/**
 * What a rule did to the plan, as a message key and its values.
 *
 * The same reasoning as `LineExplanation`: this engine has no language, and a
 * note assembled here in English would be untranslatable at the screen.
 */
export interface RuleNote {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * Turning rule actions into claims.
 *
 * The rule engine decides *what* a household asked for; this decides what that
 * means for a plan. Keeping the two apart is what lets a rule be audited: the
 * action stored in `app.rule_executions` is the household's instruction, and the
 * claim here is this engine's reading of it, which can be re-derived and argued
 * with later.
 *
 * Two constraints keep customer-authored rules from doing damage:
 *
 *   - A rule may raise a claim, never lower one. Reducing what the household
 *     already committed to is what `stop_allocation` is for, explicitly.
 *   - `set_priority` reorders a claim *inside its tier* and never across tiers.
 *     Without that, a rule could put a travel fund ahead of rent, which is not a
 *     preference — it is an eviction.
 */

/** Where a target reference lands on the ladder when a rule creates it. */
const TARGET_PREFIXES: Record<string, ClaimKind> = {
  goal: 'goal',
  debt: 'high_interest_debt',
  tax: 'tax_reserve',
  investment: 'investment',
  obligation: 'upcoming_essential',
};

const PRIORITY_WEIGHTS: Record<AllocationPriority, number> = {
  critical: 0,
  high: 25,
  normal: 50,
  low: 100,
};

export interface RuleApplication {
  readonly claims: readonly Claim[];
  readonly order: readonly ClaimKind[];
  /** What each action did, for the plan's own explanation. */
  readonly notes: readonly RuleNote[];
}

export function applyRuleActions(
  claims: readonly Claim[],
  actions: readonly Action[],
  incoming: Money,
  order: readonly ClaimKind[] = DEFAULT_PRIORITY_ORDER,
): RuleApplication {
  const byTarget = new Map<TargetRef, Claim>(claims.map((claim) => [claim.target, claim]));
  const stopped = new Set<TargetRef>();
  const notes: RuleNote[] = [];
  let effectiveOrder = [...order];

  for (const action of actions) {
    switch (action.type) {
      case 'stop_allocation': {
        // A stop stays stopped. "WHEN Travel Fund >= $2,000 THEN stop travel
        // contributions" must not be undone by a rule further down the list.
        stopped.add(action.target);
        byTarget.delete(action.target);
        notes.push({ key: 'paused', values: { target: action.target } });
        break;
      }

      case 'allocate_percentage': {
        if (stopped.has(action.target)) break;
        const requested = incoming.percentage(action.percent);
        raise(byTarget, action.target, requested, notes, {
          key: 'percentOfIncoming',
          values: { percent: action.percent },
        });
        break;
      }

      case 'allocate_amount': {
        if (stopped.has(action.target)) break;
        if (action.currency !== incoming.currency) {
          notes.push({ key: 'otherCurrency', values: { target: action.target } });
          break;
        }
        const requested = Money.fromDecimalString(action.amount, incoming.currency);
        raise(byTarget, action.target, requested, notes, {
          key: 'fixedAmount',
          values: { amount: requested.toCurrencyString() },
        });
        break;
      }

      case 'set_priority': {
        const existing = byTarget.get(action.target);
        if (!existing) break;
        byTarget.set(action.target, { ...existing, weight: PRIORITY_WEIGHTS[action.priority] });
        notes.push({
          key: 'marked',
          values: { label: existing.label, priority: action.priority },
        });
        break;
      }

      case 'reserve_taxes_first': {
        effectiveOrder = [
          'tax_reserve',
          ...effectiveOrder.filter((kind) => kind !== 'tax_reserve'),
        ];
        notes.push({ key: 'taxesFirst', values: {} });
        break;
      }

      // Classification actions belong to the category engine, not here. Ignored
      // rather than mishandled.
      case 'set_category':
      case 'flag_for_review':
        break;
    }
  }

  return { claims: [...byTarget.values()], order: effectiveOrder, notes };
}

function raise(
  byTarget: Map<TargetRef, Claim>,
  target: TargetRef,
  requested: Money,
  notes: RuleNote[],
  amount: RuleNote,
): void {
  const existing = byTarget.get(target);

  if (existing) {
    if (requested.greaterThan(existing.requested)) {
      byTarget.set(target, { ...existing, requested });
      notes.push({
        key: `raised.${amount.key}`,
        values: { label: existing.label, ...amount.values },
      });
    }
    return;
  }

  const kind = kindForTarget(target);
  if (!kind) {
    notes.push({ key: 'unreachableTarget', values: { target } });
    return;
  }

  const label = labelForTarget(target);
  byTarget.set(target, { id: `rule:${target}`, kind, label, target, requested });
  notes.push({ key: `added.${amount.key}`, values: { label, ...amount.values } });
}

function kindForTarget(target: TargetRef): ClaimKind | null {
  const prefix = target.split(':')[0] ?? '';
  return TARGET_PREFIXES[prefix] ?? null;
}

function labelForTarget(target: TargetRef): string {
  const name = target.split(':')[1] ?? target;
  return name.replace(/[-_]/g, ' ');
}
