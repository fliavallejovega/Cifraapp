'use client';

import { Money, formatMoney, type MoneyLocale } from '@app/domain';
import { Gauge, type GaugeProps } from '@app/ui';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Motion primitives for the marketing site.
 *
 * Four of them, each with one job. Everything rises once into view and stays;
 * nothing loops, nothing bounces, nothing moves without the reader scrolling.
 * `prefers-reduced-motion` turns travel off and keeps the fade, which is the
 * design system's rule for the product and holds here too.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  readonly children: ReactNode;
  readonly delay?: number;
  readonly className?: string;
  readonly as?: 'div' | 'section' | 'li' | 'p' | 'h1' | 'h2' | 'h3';
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];

  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: reduced ? 0.3 : 0.8, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}

/** Children rise one after another. */
export function Stagger({
  children,
  className,
  step = 0.08,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly step?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : step } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: reduced ? 0 : 20 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** A surface that drifts a little slower than the page. */
export function Drift({
  children,
  className,
  distance = 40,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);

  return (
    <motion.div ref={ref} className={className} {...(reduced ? {} : { style: { y } })}>
      {children}
    </motion.div>
  );
}

/**
 * A figure that counts up to its value the first time it is seen.
 *
 * The tween runs on minor units and every frame is formatted through
 * `formatMoney`, so the display is a `Money` at all times and never a float
 * pretending to be one.
 */
export function CountUp({
  value,
  locale,
  className,
  duration = 1.6,
}: {
  readonly value: Money;
  readonly locale: MoneyLocale;
  readonly className?: string;
  readonly duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  // Minor units from the decimal string, by integer arithmetic on its parts.
  const [whole = '0', fraction = ''] = value.toDecimalString().replace('-', '').split('.');
  const sign = value.isNegative() ? -1 : 1;
  const target = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2)));
  const progress = useMotionValue(0);
  const [shown, setShown] = useState(reduced ? target : 0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(target);
      return;
    }
    const controls = animate(progress, target, {
      duration,
      ease: EASE,
      onUpdate: (latest) => {
        setShown(Math.round(latest));
      },
    });
    return () => {
      controls.stop();
    };
  }, [inView, reduced, target, duration, progress]);

  return (
    <span ref={ref} className={className}>
      {formatMoney(Money.fromMinorUnits(shown, value.currency), { locale })}
    </span>
  );
}

/** The gauge, filling from empty the first time it is seen. */
export function LiveGauge(props: GaugeProps & { readonly duration?: string }) {
  const { duration = '1400ms', value, ...rest } = props;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Money>(reduced ? value : Money.zero(value.currency));

  useEffect(() => {
    if (inView) setShown(value);
  }, [inView, value]);

  // The gauge already transitions its level; only the pace changes here.
  const style = { '--duration-settle': duration } as CSSProperties;

  return (
    <div ref={ref} style={style}>
      <Gauge {...rest} value={shown} />
    </div>
  );
}

/** A card that lifts a little under the pointer. */
export function Lift({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      {...(reduced ? {} : { whileHover: { y: -4 } })}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
