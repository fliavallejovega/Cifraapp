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
 */

const SCRIPT_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function MarketChart({
  symbol,
  locale,
  label,
}: {
  readonly symbol: string;
  readonly locale: string;
  /** Announced to a screen reader, which cannot read a canvas of prices. */
  readonly label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const root = document.documentElement;
    const explicit = root.dataset['theme'];
    const theme =
      explicit === 'light' || explicit === 'dark'
        ? explicit
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = 'text/javascript';
    script.onerror = () => {
      setFailed(true);
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
      element.replaceChildren();
    };
  }, [symbol, locale]);

  if (failed) {
    return null;
  }

  return (
    <div
      role="img"
      aria-labelledby={titleId}
      className="overflow-hidden rounded-(--radius-sm) border border-[color:var(--color-rule)]"
    >
      <span id={titleId} className="sr-only">
        {label}
      </span>
      <div ref={host} className="h-[320px] w-full" />
    </div>
  );
}
