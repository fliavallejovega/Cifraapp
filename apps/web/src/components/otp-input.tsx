'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Six digits, and nothing to press afterwards.
 *
 * One real input carries the value — so paste, autofill from a text message
 * and screen readers all work — and six boxes draw it. When the sixth digit
 * lands the form submits itself. A person holding a phone with a code on it
 * should have to do exactly one thing: type it.
 *
 * Digits only, and only six. Anything else is dropped as it is typed rather
 * than rejected afterwards.
 */
export function OtpInput({
  name = 'code',
  label,
  disabled = false,
  invalid = false,
  autoFocus = true,
}: {
  readonly name?: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const submitted = useRef('');

  useEffect(() => {
    if (value.length === 6 && submitted.current !== value && !disabled) {
      submitted.current = value;
      input.current?.form?.requestSubmit();
    }
  }, [value, disabled]);

  // A rejected code comes back with the form re-enabled; the boxes clear so the
  // next attempt starts clean rather than editing a wrong code digit by digit.
  useEffect(() => {
    if (invalid && !disabled) {
      setValue('');
      submitted.current = '';
      input.current?.focus();
    }
  }, [invalid, disabled]);

  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? '');
  const active = Math.min(value.length, 5);

  return (
    <div
      className="relative"
      onClick={() => {
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        name={name}
        value={value}
        onChange={(event) => {
          setValue(event.target.value.replace(/\D/g, '').slice(0, 6));
        }}
        inputMode="numeric"
        pattern="\d{6}"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        maxLength={6}
        // Present for the browser and assistive tech, invisible for the eye:
        // the boxes below are the visual.
        className="absolute inset-0 h-full w-full opacity-0"
        style={{ caretColor: 'transparent' }}
      />
      <div aria-hidden className="flex justify-between gap-2 sm:gap-3">
        {digits.map((digit, index) => (
          <span
            key={index}
            className={[
              'flex h-14 flex-1 items-center justify-center rounded-(--radius-md) border text-2xl transition-[border-color,box-shadow,transform] duration-(--duration-quick) ease-(--ease-settle)',
              'readout bg-[color:var(--color-surface)] text-[color:var(--color-ink)]',
              invalid
                ? 'border-[color:var(--color-negative)]'
                : index === active && !disabled
                  ? 'border-[color:var(--color-brand)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-brand)_25%,transparent)]'
                  : 'border-[color:var(--color-surface-border)]',
              digit ? 'scale-100' : 'scale-[0.98]',
              disabled ? 'opacity-60' : '',
            ].join(' ')}
          >
            {digit}
          </span>
        ))}
      </div>
    </div>
  );
}
