'use client';

import { Button, Problem, Status } from '@app/ui';
import {
  COPY_FIELDS,
  COPY_LIMITS,
  definitionFor,
  renderEmail,
  validateCopy,
  type CopyField,
  type CopyProblem,
  type EmailCopy,
  type EmailLocale,
} from '@app/email';
import { useActionState, useMemo, useRef, useState } from 'react';

import {
  publishEmailTemplate,
  resetEmailTemplate,
  restoreEmailVersion,
  saveEmailTemplate,
  sendEmailTest,
  type EmailActionResult,
} from '@/server/email-actions';
import { sampleFor } from '@/server/email-samples';
import type { SupabaseState, VersionEntry } from '@/server/email-templates';

/**
 * One email, edited next to how it will arrive.
 *
 * The left column is the text; the right column is the email itself, rendered
 * by the same function that sends it, so the preview cannot drift from the
 * real thing. Six fields and no markup: the design is fixed, and a slip in the
 * sign-in email's HTML would lock every customer out.
 *
 * Errors show when a field is left, not while it is being typed, and again for
 * every field on an attempt to save. The server checks the same rules again;
 * this screen is for whoever is writing, that one is the one that decides.
 */

const LABELS: Record<CopyField, { label: string; hint: string }> = {
  subject: { label: 'Subject', hint: 'What the inbox shows in bold.' },
  preheader: {
    label: 'Preview text',
    hint: 'The grey line after the subject, read before the email is opened.',
  },
  heading: { label: 'Heading', hint: 'The first line inside the email.' },
  body: { label: 'Body', hint: 'Plain text. A blank line starts a new paragraph.' },
  ctaLabel: { label: 'Button', hint: 'Leave it empty for an email without a button.' },
  footnote: { label: 'Footnote', hint: 'Why this email arrives, and how to stop it if it can be stopped.' },
};

const MULTILINE: ReadonlySet<CopyField> = new Set(['body', 'footnote']);

function problemText(problem: CopyProblem): string {
  switch (problem.kind) {
    case 'empty':
      return `${LABELS[problem.field].label} can’t be empty.`;
    case 'too_long':
      return `Keep it under ${problem.detail} characters.`;
    case 'unknown_variable':
      return `{${problem.detail}} isn’t a variable of this email. Use one from the list.`;
    case 'raw_template':
      return 'Double braces are Supabase code, not text. Write variables with single braces, like {email}.';
    case 'button_required':
      return 'This email only works through its button. Give the button a label.';
  }
}

function resultText(result: EmailActionResult): { tone: 'positive' | 'caution' | 'negative'; text: string } | null {
  if (result.error) {
    const text: Record<NonNullable<EmailActionResult['error']>, string> = {
      forbidden: 'Your role can read emails but not change them. Content administrators can.',
      unknownTemplate: 'That email is no longer in the catalogue.',
      invalid: 'Nothing was saved. Fix the fields marked below.',
      conflict:
        'Someone saved this email while you were editing. Reload to see their version; your text stays on screen so you can copy it.',
      mailNotConfigured: 'This deployment has no Brevo key or sender, so it can’t send a test.',
      sendFailed: `Brevo didn’t accept the test: ${result.detail ?? 'no reason given'}.`,
      generic: 'Nothing was saved. Try again.',
    };
    return { tone: 'negative', text: text[result.error] };
  }

  const publish =
    result.publish === 'published'
      ? ' Supabase has it now.'
      : result.publish === 'noToken'
        ? ' It isn’t in Supabase yet: this deployment has no SUPABASE_ACCESS_TOKEN, so account emails keep their previous text until someone publishes.'
        : result.publish === 'failed'
          ? ` Supabase rejected the update (${result.detail ?? 'no reason given'}), so account emails keep their previous text. Publish again.`
          : '';
  const tone = result.publish === 'noToken' || result.publish === 'failed' ? 'caution' : 'positive';

  switch (result.ok) {
    case 'saved':
      return { tone, text: `Saved. New emails use this text.${publish}` };
    case 'restored':
      return { tone, text: `Version restored.${publish}` };
    case 'reset':
      return { tone, text: `Back to the default text.${publish}` };
    case 'published':
      return { tone, text: publish.trim() || 'Published.' };
    case 'testSent':
      return { tone: 'positive', text: `Test sent to ${result.detail ?? 'you'}. Look for it with «Prueba» or «Test» in the subject.` };
    case 'unchanged':
      return { tone: 'positive', text: 'Nothing to save: the text is the same as the saved version.' };
    case undefined:
      return null;
  }
  return null;
}

function Feedback({ result }: { readonly result: EmailActionResult }) {
  const message = resultText(result);
  if (!message) return null;
  if (message.tone === 'negative') return <Problem title="Not done" body={message.text} />;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-pretty">
      <Status tone={message.tone}>{message.tone === 'positive' ? 'Done' : 'Attention'}</Status>
      <span className="text-[color:var(--color-ink-secondary)]">{message.text}</span>
    </p>
  );
}

const CONTROL =
  'w-full rounded-(--radius-sm) border bg-[color:var(--color-surface)] px-3 text-[color:var(--color-ink)] ' +
  'shadow-[inset_0_1px_2px_var(--c-shadow-near)] placeholder:text-[color:var(--color-ink-tertiary)] ' +
  'transition-[border-color,box-shadow] duration-(--duration-quick) ease-(--ease-settle) ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)] ' +
  'read-only:bg-[color:var(--color-ground-sunk)]';

const REASON: Record<VersionEntry['reason'], string> = {
  edit: 'Edited',
  restore: 'Restored',
  reset: 'Back to default',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Panama',
  });
}

function SupabasePanel({
  state,
  canEdit,
  dirty,
  templateKey,
}: {
  readonly state: SupabaseState;
  readonly canEdit: boolean;
  readonly dirty: boolean;
  readonly templateKey: string;
}) {
  const [result, action, pending] = useActionState<EmailActionResult, FormData>(publishEmailTemplate, {});

  if (state.kind === 'notApplicable') return null;

  const line =
    state.kind === 'noToken'
      ? { tone: 'caution' as const, label: 'Can’t check', text: 'This deployment has no SUPABASE_ACCESS_TOKEN, so it can neither read nor publish what Supabase sends.' }
      : state.kind === 'unreadable'
        ? { tone: 'negative' as const, label: 'Unreadable', text: `Supabase didn’t answer: ${state.reason}.` }
        : state.kind === 'needsSmtp'
          ? {
              tone: 'caution' as const,
              label: 'Needs SMTP',
              text: 'Supabase still sends with its own mail server, and on the free plan it refuses template changes until the project has its own SMTP. Saving keeps the text here; it reaches Supabase once Brevo’s SMTP is connected.',
            }
          : state.kind === 'differs'
          ? { tone: 'caution' as const, label: 'Not published', text: 'Supabase is sending different text from the saved version below.' }
          : state.sending
            ? { tone: 'positive' as const, label: 'Live', text: 'Supabase is sending exactly the saved version, in both languages.' }
            : {
                tone: 'neutral' as const,
                label: 'Live · switched off',
                text: 'Supabase has this text but won’t send this notice until it is switched on under Authentication → Notifications.',
              };

  return (
    <div className="flex flex-col gap-3 rounded-(--radius-sm) border border-[color:var(--color-rule)] p-4">
      <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
        In Supabase
      </p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-pretty">
        <Status tone={line.tone}>{line.label}</Status>
        <span className="text-[color:var(--color-ink-secondary)]">{line.text}</span>
      </p>
      {state.kind === 'differs' && canEdit && (
        <form action={action}>
          <input type="hidden" name="templateKey" value={templateKey} />
          <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={dirty}>
            Publish the saved version
          </Button>
          {dirty && (
            <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
              Save or discard your changes first.
            </p>
          )}
        </form>
      )}
      <Feedback result={result} />
    </div>
  );
}

export interface EmailEditorProps {
  readonly templateKey: string;
  readonly locale: EmailLocale;
  readonly saved: EmailCopy;
  readonly isEdited: boolean;
  readonly baseVersion: number;
  readonly savedStamp: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
  readonly canEdit: boolean;
  readonly editorEmail: string;
  readonly productUrl: string;
  readonly mailConfigured: boolean;
  readonly publishConfigured: boolean;
  readonly supabase: SupabaseState;
  readonly versions: readonly VersionEntry[];
}

export function EmailEditor(props: EmailEditorProps) {
  const definition = definitionFor(props.templateKey);
  const { saved, locale, canEdit } = props;

  const [copy, setCopy] = useState<EmailCopy>(saved);
  const [touched, setTouched] = useState<ReadonlySet<CopyField>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  const [confirmReset, setConfirmReset] = useState(false);

  // When the saved version changes underneath —a save, a restore, a reset—
  // the fields follow it. Adjusted during render rather than in an effect, so
  // there is no frame showing the old text next to the new version number.
  const [stamp, setStamp] = useState(props.savedStamp);
  if (stamp !== props.savedStamp) {
    setStamp(props.savedStamp);
    setCopy(saved);
    setTouched(new Set());
    setShowAll(false);
    setConfirmReset(false);
  }

  const refs = useRef<Partial<Record<CopyField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [focused, setFocused] = useState<CopyField>('body');

  const [saveResult, saveAction, saving] = useActionState<EmailActionResult, FormData>(saveEmailTemplate, {});
  const [testResult, testAction, testing] = useActionState<EmailActionResult, FormData>(sendEmailTest, {});
  const [resetResult, resetAction, resetting] = useActionState<EmailActionResult, FormData>(resetEmailTemplate, {});
  const [restoreResult, restoreAction, restoring] = useActionState<EmailActionResult, FormData>(
    restoreEmailVersion,
    {},
  );

  const problems = useMemo(() => (definition ? validateCopy(definition, copy) : []), [definition, copy]);
  const serverProblems = saveResult.problems ?? testResult.problems ?? restoreResult.problems ?? [];

  const rendered = useMemo(() => {
    if (!definition) return null;
    return renderEmail({
      definition,
      copy,
      locale,
      mode: 'send',
      ...sampleFor(definition, locale, props.productUrl),
      preview: scheme,
    });
  }, [definition, copy, locale, props.productUrl, scheme]);

  if (!definition || !rendered) return null;

  const dirty = COPY_FIELDS.some((field) => copy[field] !== saved[field]);
  const fields = COPY_FIELDS.filter((field) => field !== 'ctaLabel' || definition.button !== null);

  const errorFor = (field: CopyField): string | undefined => {
    const own = [...problems, ...serverProblems].find((one) => one.field === field);
    if (!own) return undefined;
    return showAll || touched.has(field) ? problemText(own) : undefined;
  };

  const insert = (name: string) => {
    const field = focused;
    const element = refs.current[field];
    const token = `{${name}}`;
    const value = copy[field];
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    setCopy({ ...copy, [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const buttonHint =
    definition.button?.required === true
      ? 'Required. Without it the email has no link and nobody can get in.'
      : LABELS.ctaLabel.hint;

  const primaryLabel = definition.channel === 'supabase' ? 'Save and publish' : 'Save changes';

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* The text */}
      <div className="flex min-w-0 flex-col gap-6">
        {!canEdit && (
          <p className="rounded-(--radius-sm) border border-[color:var(--color-rule-strong)] p-4 text-sm text-pretty text-[color:var(--color-ink-secondary)]">
            Read-only. Your role can see every email; content administrators can change them.
          </p>
        )}

        <p className="text-sm text-[color:var(--color-ink-secondary)]">
          {props.isEdited && props.updatedAt
            ? `Edited text, version ${String(props.baseVersion)}, saved ${when(props.updatedAt)}${props.updatedBy ? ` by ${props.updatedBy}` : ''}.`
            : 'Sending the default text. Your first save becomes version 1; the default stays available.'}
        </p>

        <form
          action={saveAction}
          onSubmit={(event) => {
            setShowAll(true);
            if (problems.length > 0) event.preventDefault();
          }}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="templateKey" value={definition.key} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="baseVersion" value={String(props.baseVersion)} />

          {fields.map((field) => {
            const id = `email-${field}`;
            const error = errorFor(field);
            const hint = field === 'ctaLabel' ? buttonHint : LABELS[field].hint;
            const shared = {
              id,
              name: field,
              value: copy[field],
              readOnly: !canEdit,
              maxLength: COPY_LIMITS[field],
              'aria-invalid': error ? true : undefined,
              'aria-describedby': `${id}-note`,
              onFocus: () => {
                setFocused(field);
              },
              onBlur: () => {
                setTouched(new Set([...touched, field]));
              },
              className: [
                CONTROL,
                error
                  ? 'border-[color:var(--color-negative)]'
                  : 'border-[color:var(--color-surface-border)] hover:border-[color:var(--color-rule-strong)]',
              ].join(' '),
            };
            const counted = field === 'subject' || field === 'preheader';

            return (
              <div key={field} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <label htmlFor={id} className="text-sm font-medium">
                    {LABELS[field].label}
                  </label>
                  {counted && (
                    <span className="tabular text-xs text-[color:var(--color-ink-tertiary)]">
                      {copy[field].length} / {COPY_LIMITS[field]}
                    </span>
                  )}
                </div>
                {MULTILINE.has(field) ? (
                  <textarea
                    {...shared}
                    ref={(element) => {
                      refs.current[field] = element;
                    }}
                    rows={field === 'body' ? 7 : 3}
                    onChange={(event) => {
                      setCopy({ ...copy, [field]: event.target.value });
                    }}
                    className={`${shared.className} min-h-24 resize-y py-2.5 leading-relaxed`}
                  />
                ) : (
                  <input
                    {...shared}
                    ref={(element) => {
                      refs.current[field] = element;
                    }}
                    type="text"
                    onChange={(event) => {
                      setCopy({ ...copy, [field]: event.target.value });
                    }}
                    className={`${shared.className} h-10`}
                  />
                )}
                <p
                  id={`${id}-note`}
                  role={error ? 'alert' : undefined}
                  className={
                    error
                      ? 'text-xs text-[color:var(--color-negative)]'
                      : 'text-xs text-[color:var(--color-ink-secondary)]'
                  }
                >
                  {error ?? hint}
                </p>
              </div>
            );
          })}

          {definition.feature !== 'none' && (
            <p className="rounded-(--radius-sm) bg-[color:var(--color-ground-sunk)] px-4 py-3 text-xs text-pretty text-[color:var(--color-ink-secondary)]">
              {definition.feature === 'rows'
                ? 'The list of payments and their total is added by the system under the body. It isn’t editable here: those are the household’s real figures.'
                : 'The code is shown by the system on its own, large, under the body. It isn’t editable here: a code that could be deleted from a text field eventually would be.'}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-col gap-4 border-t border-[color:var(--color-rule)] pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={saving} disabled={!dirty || testing}>
                  {primaryLabel}
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  formAction={testAction}
                  loading={testing}
                  disabled={!props.mailConfigured || saving}
                  title={props.mailConfigured ? undefined : 'This deployment has no Brevo key or sender.'}
                >
                  Send a test to me
                </Button>
                {dirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setCopy(saved);
                      setTouched(new Set());
                      setShowAll(false);
                    }}
                  >
                    Discard changes
                  </Button>
                )}
              </div>
              <p className="text-xs text-[color:var(--color-ink-tertiary)]">
                The test goes to {props.editorEmail} with what’s on screen, saved or not.
                {definition.channel === 'supabase' && !props.publishConfigured
                  ? ' Saving here won’t reach Supabase from this deployment: it has no SUPABASE_ACCESS_TOKEN.'
                  : ''}
              </p>
              <Feedback result={saveResult} />
              <Feedback result={testResult} />
            </div>
          )}
        </form>

        {definition.variables.length > 0 && (
          <section aria-labelledby="variables-title" className="flex flex-col gap-3">
            <h2 id="variables-title" className="text-sm font-medium">
              Variables
            </h2>
            <p className="text-xs text-pretty text-[color:var(--color-ink-secondary)]">
              Each is replaced by the real value when the email is sent.
              {canEdit ? ` Choose one to insert it where the cursor is in «${LABELS[focused].label}».` : ''}
            </p>
            <ul className="flex flex-col gap-2">
              {definition.variables.map((variable) => (
                <li key={variable.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      insert(variable.name);
                    }}
                    className="rounded-(--radius-xs) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-2 py-1 font-(family-name:--font-mono) text-xs transition-colors duration-(--duration-quick) hover:border-[color:var(--color-rule-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)] disabled:cursor-default"
                  >
                    {`{${variable.name}}`}
                  </button>
                  <span className="text-xs text-[color:var(--color-ink-secondary)]">
                    {variable.description}{' '}
                    <span className="text-[color:var(--color-ink-tertiary)]">
                      Preview: {variable.example[locale]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <SupabasePanel state={props.supabase} canEdit={canEdit} dirty={dirty} templateKey={definition.key} />

        {canEdit && props.isEdited && (
          <form action={resetAction} className="flex flex-col gap-3 border-t border-[color:var(--color-rule)] pt-5">
            <input type="hidden" name="templateKey" value={definition.key} />
            <input type="hidden" name="locale" value={locale} />
            {confirmReset ? (
              <>
                <p className="text-sm text-pretty text-[color:var(--color-ink-secondary)]">
                  The {locale === 'es' ? 'Spanish' : 'English'} version goes back to the default text.
                  The edited text stays in the history, and you can restore it from there.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" variant="destructive" loading={resetting}>
                    Go back to the default
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setConfirmReset(false);
                    }}
                  >
                    Keep the edited text
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfirmReset(true);
                  }}
                >
                  Go back to the default text…
                </Button>
              </div>
            )}
            <Feedback result={resetResult} />
          </form>
        )}

        <section aria-labelledby="history-title" className="flex flex-col gap-3">
          <h2 id="history-title" className="text-sm font-medium">
            History
          </h2>
          {props.versions.length === 0 ? (
            <p className="text-xs text-pretty text-[color:var(--color-ink-secondary)]">
              No saved versions yet. Every save, restore and return to the default is kept here, so a
              wrong email can always be traced and undone.
            </p>
          ) : (
            <form action={restoreAction}>
              <ul className="divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
                {props.versions.map((version) => {
                  const current = version.version === props.baseVersion && props.isEdited;
                  return (
                    <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="tabular text-[color:var(--color-ink-tertiary)]">v{version.version}</span>{' '}
                          {REASON[version.reason]}
                          {current && <span className="ml-2 text-xs text-[color:var(--color-ink-tertiary)]">current</span>}
                        </p>
                        <p className="truncate text-xs text-[color:var(--color-ink-secondary)]">{version.subject}</p>
                        <p className="text-xs text-[color:var(--color-ink-tertiary)]">
                          {when(version.createdAt)}
                          {version.createdBy ? ` · ${version.createdBy}` : ''}
                        </p>
                      </div>
                      {canEdit && !current && (
                        <Button
                          type="submit"
                          name="versionId"
                          value={version.id}
                          variant="secondary"
                          size="sm"
                          disabled={restoring || dirty}
                        >
                          Restore
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {dirty && canEdit && (
                <p className="mt-2 text-xs text-[color:var(--color-ink-tertiary)]">
                  Save or discard your changes before restoring a version.
                </p>
              )}
              <div className="mt-3">
                <Feedback result={restoreResult} />
              </div>
            </form>
          )}
        </section>
      </div>

      {/* The email */}
      <div className="min-w-0 lg:sticky lg:top-8 lg:self-start">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium tracking-(--tracking-label) text-[color:var(--color-ink-tertiary)] uppercase">
            Preview · example values
          </p>
          <div className="flex gap-2">
            <Segmented
              label="Appearance"
              value={scheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={setScheme}
            />
            <Segmented
              label="Width"
              value={width}
              options={[
                { value: 'desktop', label: 'Desktop' },
                { value: 'phone', label: 'Phone' },
              ]}
              onChange={setWidth}
            />
          </div>
        </div>

        {/* The inbox row: what a person sees before deciding to open it. */}
        <div className="rounded-t-(--radius-lg) border border-b-0 border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-4 py-3">
          <p className="flex items-baseline gap-3 text-sm">
            <span className="shrink-0 font-medium">Cifraapp</span>
            <span className="min-w-0 truncate">
              <span className="font-medium">{rendered.subject || 'No subject'}</span>
              <span className="text-[color:var(--color-ink-tertiary)]"> — {rendered.preheader}</span>
            </span>
          </p>
        </div>
        <div className="overflow-hidden rounded-b-(--radius-lg) border border-[color:var(--color-surface-border)] bg-[color:var(--color-ground-sunk)]">
          <iframe
            title={`Preview of «${definition.name}»`}
            srcDoc={rendered.html}
            sandbox=""
            className="mx-auto block h-[680px] w-full border-0 transition-[max-width] duration-(--duration-settle) ease-(--ease-settle)"
            style={{ maxWidth: width === 'phone' ? 375 : '100%' }}
          />
        </div>
        <p className="mt-3 text-xs text-pretty text-[color:var(--color-ink-tertiary)]">
          Rendered by the same function that sends it. Links are inert here.
          {definition.channel === 'supabase'
            ? ' Supabase fills in the real link and address when it sends.'
            : ''}
        </p>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={[
            'rounded-(--radius-xs) px-3 py-1.5 text-xs transition-colors duration-(--duration-quick) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)]',
            option.value === value
              ? 'bg-[color:var(--color-ground-sunk)] font-medium text-[color:var(--color-ink)]'
              : 'text-[color:var(--color-ink-secondary)] hover:text-[color:var(--color-ink)]',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
