'use client';

import { Input } from '@app/ui';
import { useEffect, useId, useRef, useState } from 'react';

import {
  IconCrypto,
  IconEquity,
  IconEtf,
  IconFund,
  IconIndex,
  IconOtherHolding,
} from '@/components/shell-icons';
import { searchSymbols, type SymbolCandidate } from '@/server/holdings-actions';

/**
 * Choosing an instrument instead of spelling one.
 *
 * The field this replaces asked a person to already know the exact string a
 * market data provider files their holding under, and punished a near miss
 * silently. Somebody with bitcoin typed «BTC», and `BTC` is a real ticker —
 * the Grayscale Bitcoin Mini Trust, a fund on NYSE Arca. The form found it,
 * priced it, showed a green line, and was about to record a fund they have
 * never owned. Nothing errored. That is the failure this component removes:
 * the symbol stops being typed and starts being picked from a list where the
 * coin and the fund named after the coin are two obviously different rows,
 * each with its own name, its own market and its own mark.
 *
 * Three rules hold the design together:
 *
 *   - **The list is never blank.** Focus the field having typed nothing and it
 *     offers what was chosen here before, then a short shelf of instruments
 *     most households recognise. Anybody who already knows what they want
 *     types straight over it.
 *   - **The filter narrows, it never relabels.** «Bonos» is a way to look, not
 *     a type: it keeps the funds whose own name says they hold debt, and every
 *     row still shows the type the provider actually assigned it.
 *   - **Nothing is claimed that was not measured.** The shelf is called «para
 *     empezar», not «los más buscados», because nobody here counts searches.
 */

/** How long the typing has to stop before the provider is asked. */
const DEBOUNCE_MS = 250;

/** How many chosen symbols are remembered, and where. */
const RECENT_KEY = 'cifra.holdings.recent';
const RECENT_LIMIT = 4;

export type SymbolScope = 'all' | 'equity' | 'fund' | 'crypto' | 'bond' | 'other';

export const SYMBOL_SCOPES: readonly SymbolScope[] = [
  'all',
  'equity',
  'fund',
  'crypto',
  'bond',
  'other',
];

/**
 * The shelf shown before anybody has typed.
 *
 * Instruments, not recommendations: a widely held share, an index fund, a
 * bond fund, the two coins most people mean when they say «cripto». They are
 * here so the panel can answer «what am I supposed to put in this box» with an
 * example rather than with white space, and so the icons and types are legible
 * before the first request. Names are the instruments' own — that is what they
 * are called, in every language.
 */
const STARTERS: readonly SymbolCandidate[] = [
  { symbol: 'BTC-USD', name: 'Bitcoin', kind: 'crypto', exchange: 'CCC' },
  { symbol: 'ETH-USD', name: 'Ethereum', kind: 'crypto', exchange: 'CCC' },
  { symbol: 'AAPL', name: 'Apple Inc.', kind: 'equity', exchange: 'NASDAQ' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', kind: 'etf', exchange: 'NYSEArca' },
  { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', kind: 'etf', exchange: 'NASDAQ' },
];

/** The one place a kind becomes a mark. Six kinds, six shapes, one family. */
export function KindIcon({ kind }: { readonly kind: string }) {
  switch (kind) {
    case 'crypto':
      return <IconCrypto />;
    case 'equity':
      return <IconEquity />;
    case 'etf':
      return <IconEtf />;
    case 'fund':
      return <IconFund />;
    case 'index':
      return <IconIndex />;
    default:
      return <IconOtherHolding />;
  }
}

type Panel =
  | { readonly kind: 'suggestions' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'results'; readonly candidates: readonly SymbolCandidate[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' };

function readRecent(): readonly SymbolCandidate[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SymbolCandidate =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as SymbolCandidate).symbol === 'string' &&
          typeof (entry as SymbolCandidate).name === 'string',
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    // A browser that refuses storage is a browser with no recent list, which
    // is a smaller loss than a form that throws while somebody types into it.
    return [];
  }
}

function rememberRecent(candidate: SymbolCandidate): void {
  try {
    const kept = [
      candidate,
      ...readRecent().filter((one) => one.symbol !== candidate.symbol),
    ].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch {
    /* Same reason. */
  }
}

export function SymbolSearch({
  id,
  describedBy,
  value,
  onType,
  onChoose,
  onCommit,
  copy,
}: {
  readonly id: string;
  readonly describedBy: string | undefined;
  /** What is in the field: a chosen symbol, or whatever is being typed. */
  readonly value: string;
  readonly onType: (value: string) => void;
  readonly onChoose: (candidate: SymbolCandidate) => void;
  /**
   * Leaving the field having typed something and chosen nothing.
   *
   * Somebody who already knows the exact symbol should not be forced through
   * the list, and the provider's index does not contain every instrument its
   * quote endpoint can price — so what was typed is still looked up on the way
   * out, exactly as it was before this component existed. Losing that turned a
   * correctly typed symbol into a row that was silently dropped on save.
   */
  readonly onCommit: (value: string) => void;
  readonly copy: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SymbolScope>('all');
  const [panel, setPanel] = useState<Panel>({ kind: 'suggestions' });
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<readonly SymbolCandidate[]>([]);
  const [attempt, setAttempt] = useState(0);

  const listId = useId();
  const container = useRef<HTMLDivElement>(null);

  // Read once on the client. `localStorage` on the server is a crash, and
  // reading it during render is a hydration mismatch.
  useEffect(() => {
    setRecent(readRecent());
  }, []);

  /**
   * The request, debounced and made cancellable by ordering.
   *
   * A server action cannot be aborted, so the guard is a sequence number: an
   * answer that is no longer the newest question is dropped rather than
   * painted. Without it, typing «bitcoin» quickly resolves «bit» last and the
   * list settles on the wrong search.
   */
  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setPanel({ kind: 'suggestions' });
      return;
    }

    let current = true;
    setPanel({ kind: 'searching' });

    const timer = setTimeout(() => {
      void searchSymbols(query, scope).then((result) => {
        if (!current) return;
        setActive(0);
        if (!result.ok) {
          setPanel(result.reason === 'too-short' ? { kind: 'suggestions' } : { kind: 'error' });
          return;
        }
        setPanel(
          result.candidates.length === 0
            ? { kind: 'empty' }
            : { kind: 'results', candidates: result.candidates },
        );
      });
    }, DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [value, scope, attempt]);

  // Clicking outside closes the panel without choosing anything, which is what
  // clicking away means everywhere else on the page.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('mousedown', away);
    };
  }, [open]);

  const suggestions: readonly SymbolCandidate[] =
    recent.length > 0
      ? [...recent, ...STARTERS.filter((one) => !recent.some((r) => r.symbol === one.symbol))]
      : STARTERS;

  const rows: readonly SymbolCandidate[] =
    panel.kind === 'results' ? panel.candidates : panel.kind === 'suggestions' ? suggestions : [];

  // The list can shrink under the cursor between one keystroke and the next.
  const highlighted = rows.length === 0 ? 0 : Math.min(active, rows.length - 1);

  const choose = (candidate: SymbolCandidate) => {
    rememberRecent(candidate);
    setRecent(readRecent());
    setOpen(false);
    onChoose(candidate);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(
        (current) => (Math.min(current, rows.length - 1) + step + rows.length) % rows.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      const candidate = open ? rows[highlighted] : undefined;
      // Only when the list is open and something is highlighted. Otherwise
      // Enter belongs to the form, not to this field.
      if (candidate) {
        event.preventDefault();
        choose(candidate);
      }
    }
  };

  return (
    <div ref={container} className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[highlighted] ? `${listId}-${highlighted}` : undefined}
        autoComplete="off"
        value={value}
        placeholder={copy('holdings.searchPlaceholder')}
        aria-describedby={describedBy}
        onFocus={() => {
          setOpen(true);
        }}
        onChange={(event) => {
          setOpen(true);
          setActive(0);
          onType(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Choosing from the list never blurs — every row and chip cancels
          // its own mousedown — so a blur here means the field was left with
          // whatever is in it.
          setOpen(false);
          onCommit(value);
        }}
      />

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-(--radius-md) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] shadow-(--shadow-popover)">
          <div
            role="group"
            aria-label={copy('holdings.scopeLabel')}
            className="flex flex-wrap gap-2 border-b border-[color:var(--color-rule)] p-3"
          >
            {SYMBOL_SCOPES.map((one) => (
              <button
                key={one}
                type="button"
                aria-pressed={scope === one}
                onMouseDown={(event) => {
                  // The field must keep focus: losing it would close the panel
                  // between the press and the click.
                  event.preventDefault();
                }}
                onClick={() => {
                  setScope(one);
                }}
                className={`flex min-h-11 items-center rounded-(--radius-xs) border px-2 text-xs transition-colors duration-(--duration-quick) ease-(--ease-settle) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)] ${
                  scope === one
                    ? 'border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-ink-inverse)]'
                    : 'border-[color:var(--color-rule)] text-[color:var(--color-ink-secondary)] hover:border-[color:var(--color-rule-strong)]'
                }`}
              >
                {copy(`holdings.scope.${one}`)}
              </button>
            ))}
          </div>

          {(panel.kind === 'suggestions' || panel.kind === 'results') && (
            <>
              {panel.kind === 'suggestions' && (
                <p className="px-3 pt-3 text-xs tracking-wide text-[color:var(--color-ink-tertiary)] uppercase">
                  {recent.length > 0
                    ? copy('holdings.searchRecent')
                    : copy('holdings.searchCommon')}
                </p>
              )}
              <ul
                id={listId}
                role="listbox"
                aria-label={copy('holdings.symbol')}
                className="max-h-72 overflow-y-auto p-2"
              >
                {rows.map((candidate, at) => (
                  <li key={candidate.symbol} role="none">
                    <button
                      id={`${listId}-${at}`}
                      role="option"
                      aria-selected={at === highlighted}
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onMouseEnter={() => {
                        setActive(at);
                      }}
                      onClick={() => {
                        choose(candidate);
                      }}
                      className={`flex w-full items-center gap-3 rounded-(--radius-sm) px-2 py-2 text-left transition-colors duration-(--duration-quick) ease-(--ease-settle) ${
                        at === highlighted ? 'bg-[color:var(--color-ground-sunk)]' : ''
                      }`}
                    >
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-xs) bg-[color:var(--color-ground-sunk)] text-[color:var(--color-ink-secondary)]"
                      >
                        <KindIcon kind={candidate.kind} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[color:var(--color-ink)]">
                          {candidate.name}
                        </span>
                        <span className="block truncate text-xs text-[color:var(--color-ink-tertiary)]">
                          <span className="readout">{candidate.symbol}</span>
                          {' · '}
                          {copy(`holdings.kind.${candidate.kind}`)}
                          {candidate.exchange ? ` · ${candidate.exchange}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {panel.kind === 'searching' && (
            <p className="p-4 text-sm text-[color:var(--color-ink-tertiary)]">
              {copy('holdings.searching')}
            </p>
          )}

          {panel.kind === 'empty' && (
            <div className="p-4">
              <p className="text-sm text-[color:var(--color-ink)]">
                {copy('holdings.searchEmpty').replace('{term}', value.trim())}
              </p>
              <p className="mt-1 text-xs text-[color:var(--color-ink-secondary)]">
                {copy('holdings.searchEmptyHint')}
              </p>
              {scope !== 'all' && (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    setScope('all');
                  }}
                  className="mt-3 min-h-11 text-xs text-[color:var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)]"
                >
                  {copy('holdings.searchAllTypes')}
                </button>
              )}
            </div>
          )}

          {panel.kind === 'error' && (
            <div className="p-4">
              <p className="text-sm text-[color:var(--color-ink)]">
                {copy('holdings.searchError')}
              </p>
              <p className="mt-1 text-xs text-[color:var(--color-ink-secondary)]">
                {copy('holdings.searchErrorHint')}
              </p>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  setAttempt((one) => one + 1);
                }}
                className="mt-3 min-h-11 text-xs text-[color:var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-ink)]"
              >
                {copy('holdings.searchRetry')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
