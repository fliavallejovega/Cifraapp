'use server';

import { rules } from '@app/database/schema';
import { isErr, type PlainDate } from '@app/domain';
import {
  factKind,
  isKnownFact,
  validateRule,
  type Action,
  type ComparisonOperator,
  type Condition,
  type Literal,
} from '@app/rule-engine';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { optionalPlainDate, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Household rules: «when this is true, do that».
 *
 * The rule engine has been able to evaluate these since Phase 8 and there was
 * no way to write one. This is that way, and it is deliberately not a text box:
 * a rule is structured data, a condition can only compare a fact from the
 * catalogue against a literal, and nothing a household writes is ever executed.
 *
 * The builder therefore offers a fact, an operator and a value — no more. That
 * is not a simplification of the language; it *is* the language, and widening
 * it is a code change and a review rather than a row in a table.
 *
 * Every rule is validated by the engine before it is stored and again when it
 * is read, so a rule written before a fact was renamed cannot reach the
 * evaluator at all.
 */

const OPERATORS: readonly ComparisonOperator[] = [
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'neq',
  'contains',
  'in',
];

/** The one action the builder writes today: move money toward a target. */
const ACTION_TYPES = ['allocate_percentage', 'allocate_amount', 'set_priority'] as const;

const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;

const ruleInput = z.object({
  name: recordName,
  explanation: z.string().trim().min(1).max(400),
  fact: z.string().trim().min(1).max(120),
  operator: z.enum(OPERATORS as [ComparisonOperator, ...ComparisonOperator[]]),
  value: z.string().trim().min(1).max(120),
  actionType: z.enum(ACTION_TYPES),
  target: z.string().trim().min(1).max(120),
  actionValue: z.string().trim().max(120).optional(),
  priority: z.coerce.number().int().min(1).max(1000),
  effectiveFrom: optionalPlainDate,
  effectiveTo: optionalPlainDate,
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  explanation: 'explanationRequired',
  fact: 'factInvalid',
  operator: 'operatorInvalid',
  value: 'valueInvalid',
  target: 'targetRequired',
} as const;

function parse(formData: FormData) {
  return ruleInput.safeParse({
    name: formData.get('name'),
    explanation: formData.get('explanation'),
    fact: formData.get('fact'),
    operator: formData.get('operator') ?? 'gte',
    value: formData.get('value'),
    actionType: formData.get('actionType') ?? 'allocate_percentage',
    target: formData.get('target'),
    actionValue: formData.get('actionValue') ?? '',
    priority: formData.get('priority') ?? '100',
    effectiveFrom: formData.get('effectiveFrom'),
    effectiveTo: formData.get('effectiveTo'),
  });
}

/**
 * Turns the form's three fields into a literal of the right kind.
 *
 * The fact decides the kind, not the person filling the form. A money fact
 * compared against a bare number would silently never match, which is the worst
 * possible failure for a rule: it does nothing, quietly, forever.
 */
function literalFor(fact: string, raw: string, currency: string): Literal | null {
  const kind = factKind(fact);

  switch (kind) {
    case 'money': {
      const amount = raw.replace(/[^\d.-]/g, '');
      if (!/^-?\d+(\.\d{1,4})?$/.test(amount)) return null;
      return { kind: 'money', amount, currency };
    }
    case 'number': {
      const value = Number(raw.replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(value)) return null;
      return { kind: 'number', value };
    }
    case 'boolean':
      return { kind: 'boolean', value: raw === 'true' || raw === 'yes' };
    case 'date':
      return { kind: 'date', value: raw };
    case 'text':
    case null:
    default:
      // `in` compares against a list, and the form collects it as a
      // comma-separated line because that is how a person writes one.
      return raw.includes(',')
        ? { kind: 'text_list', values: raw.split(',').map((entry) => entry.trim()) }
        : { kind: 'text', value: raw };
  }
}

function actionFor(
  type: (typeof ACTION_TYPES)[number],
  target: string,
  value: string,
  currency: string,
): Action | null {
  if (type === 'allocate_percentage') {
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 100) return null;
    return { type: 'allocate_percentage', target, percent: value };
  }

  if (type === 'allocate_amount') {
    if (!/^\d+(\.\d{1,4})?$/.test(value)) return null;
    return { type: 'allocate_amount', target, amount: value, currency };
  }

  const priority = PRIORITIES.find((entry) => entry === value) ?? 'normal';
  return { type: 'set_priority', target, priority };
}

function buildRule(
  id: string,
  data: z.infer<typeof ruleInput>,
  currency: string,
): { condition: Condition; actions: readonly Action[] } | { error: string } {
  if (!isKnownFact(data.fact)) return { error: 'factInvalid' };

  const literal = literalFor(data.fact, data.value, currency);
  if (!literal) return { error: 'valueInvalid' };

  const action = actionFor(data.actionType, data.target, data.actionValue ?? '', currency);
  if (!action) return { error: 'actionValueInvalid' };

  const condition: Condition = {
    type: 'compare',
    fact: data.fact,
    operator: data.operator,
    value: literal,
  };

  const validated = validateRule({
    id,
    name: data.name,
    explanation: data.explanation,
    when: condition,
    then: [action],
    priority: data.priority,
    isActive: true,
    // Validated against the `YYYY-MM-DD` shape by the schema above, which is
    // exactly what `PlainDate` asserts (ADR-006).
    effectiveFrom: (data.effectiveFrom as PlainDate | undefined) ?? null,
    effectiveTo: (data.effectiveTo as PlainDate | undefined) ?? null,
  });

  if (isErr(validated)) return { error: 'ruleInvalid' };

  return { condition, actions: [action] };
}

export async function createRule(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const householdId = session.activeHouseholdId;
  const currency = currencyOf(session, householdId);

  // A placeholder id for validation only. The database assigns the real one,
  // and the engine only needs *an* id to check the shape.
  const built = buildRule('00000000-0000-7000-8000-000000000000', parsed.data, currency);
  if ('error' in built) return { error: built.error };

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(rules)
      .values({
        householdId,
        createdBy: session.user.id,
        name: parsed.data.name,
        explanation: parsed.data.explanation,
        conditions: built.condition,
        actions: built.actions,
        priority: parsed.data.priority,
        isActive: true,
        source: 'user',
        ...(parsed.data.effectiveFrom ? { effectiveFrom: parsed.data.effectiveFrom } : {}),
        ...(parsed.data.effectiveTo ? { effectiveTo: parsed.data.effectiveTo } : {}),
      })
      .returning({ id: rules.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateRule(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const householdId = session.activeHouseholdId;
  const currency = currencyOf(session, householdId);

  const built = buildRule(id.data, parsed.data, currency);
  if ('error' in built) return { error: built.error };

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(rules)
      .set({
        name: parsed.data.name,
        explanation: parsed.data.explanation,
        conditions: built.condition,
        actions: built.actions,
        priority: parsed.data.priority,
        effectiveFrom: parsed.data.effectiveFrom ?? null,
        effectiveTo: parsed.data.effectiveTo ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(rules.id, id.data), eq(rules.householdId, householdId), isNull(rules.deletedAt)),
      )
      .returning({ id: rules.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Retires a rule.
 *
 * Soft, because `rule_executions` points at it. A plan that was reshaped by a
 * rule has to keep naming the rule that reshaped it, or the audit trail leads
 * to a row that no longer exists.
 */
export async function removeRule(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(rules)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(rules.id, id.data), eq(rules.householdId, householdId), isNull(rules.deletedAt)),
      )
      .returning({ id: rules.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

function firstIssue(error: z.ZodError): string {
  const path = error.issues[0]?.path[0];
  return (
    (typeof path === 'string' ? FIELD_ERRORS[path as keyof typeof FIELD_ERRORS] : undefined) ??
    'invalid'
  );
}
