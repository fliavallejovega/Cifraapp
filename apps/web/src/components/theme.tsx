'use client';

import { useEffect, useState } from 'react';

/**
 * Light, dark, or whatever the machine says.
 *
 * The token file already defines all three: a `prefers-color-scheme` block for
 * the system default, and `[data-theme]` on the root for an explicit choice
 * that outranks it in both directions. So the whole switch is one attribute,
 * and the palette work is already done.
 *
 * The choice is per device, in `localStorage`, not on the profile. Somebody
 * reading their finances on a phone at night and on a laptop at noon wants two
 * different answers, and a server-stored preference would make them fight.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cifrapp-theme';

/**
 * Applied before the first paint by a blocking inline script.
 *
 * Without it a person who chose dark gets a white flash on every navigation —
 * on a financial screen at night, which is precisely when they chose it. It is
 * deliberately tiny and dependency-free, because it runs ahead of everything.
 */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // A browser with site data blocked. The system preference is the answer,
    // and it is a working one.
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === 'system') {
    delete root.dataset['theme'];
  } else {
    root.dataset['theme'] = choice;
  }

  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The theme still applies for this session; it just will not be remembered.
  }
}

export interface ThemeSwitchLabels {
  readonly legend: string;
  readonly system: string;
  readonly light: string;
  readonly dark: string;
}

const OPTIONS: readonly ThemeChoice[] = ['system', 'light', 'dark'];

export function ThemeSwitch({ labels }: { readonly labels: ThemeSwitchLabels }) {
  // Starts at `system` on the server and on the first client render, then
  // corrects itself. Rendering the stored value directly would be a hydration
  // mismatch, because the server cannot read localStorage.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChoice(readStored());
    setReady(true);
  }, []);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{labels.legend}</legend>

      <div
        role="radiogroup"
        aria-label={labels.legend}
        className="flex rounded-(--radius-sm) bg-[color:var(--color-panel-raised)] p-0.5"
      >
        {OPTIONS.map((option) => {
          const selected = ready && choice === option;

          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              title={labels[option]}
              onClick={() => {
                setChoice(option);
                apply(option);
              }}
              className={[
                'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-2',
                'text-[0.6875rem] font-medium transition-colors duration-(--duration-quick)',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--color-brand)]',
                selected
                  ? 'bg-[color:var(--color-panel)] text-[color:var(--color-brand)]'
                  : 'text-[color:var(--color-panel-ink-secondary)] hover:text-[color:var(--color-panel-ink)]',
              ].join(' ')}
            >
              <span aria-hidden className="shrink-0">
                <ThemeIcon choice={option} />
              </span>
              <span className="truncate">{labels[option]}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The same outline family as the navigation, at the same stroke width. */
function ThemeIcon({ choice }: { readonly choice: ThemeChoice }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: 13,
    height: 13,
    'aria-hidden': true,
  };

  if (choice === 'light') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="2.6" />
        <path d="M8 1.6v1.4M8 13v1.4M14.4 8H13M3 8H1.6M12.5 3.5l-1 1M5.5 10.5l-1 1M12.5 12.5l-1-1M5.5 5.5l-1-1" />
      </svg>
    );
  }

  if (choice === 'dark') {
    return (
      <svg {...common}>
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="1.8" y="3" width="12.4" height="8.4" rx="1.4" />
      <path d="M5.6 14h4.8" />
    </svg>
  );
}
