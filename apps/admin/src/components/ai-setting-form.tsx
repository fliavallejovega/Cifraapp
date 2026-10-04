'use client';

import { Button, Status } from '@app/ui';
import { useActionState } from 'react';

import { saveAISetting, type AISettingResult } from '@/server/ai-settings-actions';

/** One job, one select, one save. Empty means «the environment's model». */
export function AISettingForm({
  purpose,
  current,
  fallback,
  models,
}: {
  readonly purpose: 'reading' | 'chat';
  readonly current: string | null;
  readonly fallback: string;
  readonly models: readonly { readonly key: string; readonly name: string }[];
}) {
  const [state, action, pending] = useActionState<AISettingResult, FormData>(saveAISetting, {});
  const id = `model-${purpose}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="purpose" value={purpose} />
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          Model
        </label>
        <select
          id={id}
          name="model"
          defaultValue={current ?? ''}
          className="h-11 rounded-(--radius-sm) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 text-sm"
        >
          <option value="">Environment default ({fallback})</option>
          {models.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name} · {model.key}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={pending}>
        Save model
      </Button>
      {state.saved && <Status tone="positive">Saved. Takes effect within a minute.</Status>}
      {state.error === 'forbidden' && (
        <Status tone="negative">Only a super admin can change this.</Status>
      )}
      {state.error === 'invalid' && (
        <Status tone="negative">That model is not active for this provider.</Status>
      )}
      {state.error === 'generic' && <Status tone="negative">Could not save. Try again.</Status>}
    </form>
  );
}
