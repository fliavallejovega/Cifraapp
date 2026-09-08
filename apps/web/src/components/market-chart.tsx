'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A price chart, from TradingView.
 *
 * The product holds no market data and does not want to: quotes are somebody
 * else's business, they go stale, and a stale price on a financial screen is
 * worse than no price. So the chart is theirs, in their iframe, and nothing it
 * shows is stored or reasoned over here.
 *
 * The widget is loaded per chart because its script writes into the element it
 * is appended to. It is torn down on unmount so navigating away does not leave
 * a running third-party frame behind.
 *
 * It follows the household's theme. A dark chart on a light page — or the
 * reverse — is the seam where an embed announces that it is not part of the
 * product.
 *
 * Because it is third-party, it has three outcomes and the screen shows all
 * three. It is slow often and blocked sometimes — an ad blocker, a corporate
 * network, an offline phone — and a financial screen that answers a blocked
 * request with an empty rectangle reads as a chart that says zero. The failure
 * says who was being called and that nothing else on the screen depends on it,
 * because nothing does: the modelling above is arithmetic on the household's
 * own figures and does not consult a price.
 */

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

/** Blocked scripts sometimes resolve without ever painting, so time out too. */
const GIVE_UP_AFTER_MS = 12_000;

export function MarketChart({
  symbol,
  locale,
  label,
  labels,
}: {
  readonly symbol: string;
  readonly locale: string;
  /** Announced to a screen reader, which cannot read a canvas of prices. */
  readonly label: string;
  readonly labels: {
    readonly loading: string;
    readonly failedTitle: string;
    readonly failedBody: string;
  };
}) {
  const host = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    setState('loading');

    const root = document.documentElement;
    const explicit = root.dataset['theme'];
    const theme =
      explicit === 'light' || explicit === 'dark'
        ? explicit
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

    // The script paints into an iframe of its own making; its arrival is the
    // only honest signal that the chart is actually up. `onload` fires when the
    // file arrives, which is earlier and not the same thing.
    const observer = new MutationObserver(() => {
      if (element.querySelector('iframe')) {
        setState('ready');
        observer.disconnect();
      }
    });
    observer.observe(element, { childList: true, subtree: true });

    const timer = window.setTimeout(() => {
      setState((current) => (current === 'ready' ? current : 'failed'));
    }, GIVE_UP_AFTER_MS);

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.onerror = () => {
      setState('failed');
    };
    script.innerHTML = JSON.stringify({
      symbol,
      theme,
      locale: locale === 'en' ? 'en' : 'es',
      interval: 'W',
      // A household deciding about a goal five years out is not helped by a
      // five-minute candle. The default range is the one that matches the
      // horizon the rest of this screen reasons in.
      range: '60M',
      autosize: true,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
    });

    element.append(script);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      element.replaceChildren();
    };
  }, [symbol, locale]);

  if (state === 'failed') {
    return (
      <div className="rounded-(--radius-sm) border border-dashed border-[color:var(--color-rule)] px-4 py-6">
        <p className="text-sm font-medium text-[color:var(--color-ink-secondary)]">
          {labels.failedTitle}
        </p>
        <p className="mt-2 text-sm/6 text-[color:var(--color-ink-tertiary)]">{labels.failedBody}</p>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-labelledby={titleId}
      aria-busy={state === 'loading'}
      className="relative overflow-hidden rounded-(--radius-sm) border border-[color:var(--color-rule)]"
    >
      <span id={titleId} className="sr-only">
        {label}
      </span>
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--color-ground-sunk)]">
          <p className="text-xs text-[color:var(--color-ink-tertiary)]">{labels.loading}</p>
        </div>
      )}
      <div ref={host} className="h-[320px] w-full" />
    </div>
  );
}
