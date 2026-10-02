import 'server-only';

import { toInstant } from '@app/itinerary';

import type { ClientLodging, ClientRumbo, ClientTodo } from '@/lib/rumbo-types';

import type { RumboView } from './rumbo';

/**
 * The trip outside the app: one self-contained HTML file (it also prints to
 * PDF from any browser) and a calendar file with each day and each flight.
 * Built from the same presented data the screens show, so a figure in the
 * file is the figure on the screen.
 */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ExportLabels {
  readonly lang: string;
  readonly printHint: string;
  readonly sleep: string;
  readonly legs: string;
  readonly watch: string;
  readonly todo: string;
  readonly lodging: string;
  readonly myPrice: string;
  readonly todos: string;
  readonly due: string;
  readonly generated: string;
  readonly disclaimer: string;
}

export function rumboHtml(
  route: ClientRumbo,
  lodging: ClientLodging | null,
  todos: readonly ClientTodo[],
  labels: ExportLabels,
): string {
  const days = route.days
    .map((d) => {
      const timeline = d.flights
        .flatMap((f) =>
          f.entries.map(
            (e) =>
              `<li><b>${e.certainty === 'confirmed' ? '' : '~'}${esc(e.time)}</b> ${esc(e.label)} · ${esc(e.place)}${
                e.certainty === 'confirmed' && (e.step === 'departs' || e.step === 'arrives')
                  ? ` · <i>${esc(e.certaintyLabel)}</i>`
                  : ''
              }${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`,
          ),
        )
        .join('');
      const legs = d.drives
        .flatMap((dr) => dr.legs)
        .map(
          (l) =>
            `<li>${esc(l.fromName)} → ${esc(l.toName)} · ${esc(l.km)} km · ~${esc(l.duration)} · <a href="${esc(l.mapsUrl)}">Google Maps</a> · <a href="${esc(l.wazeUrl)}">Waze</a></li>`,
        )
        .join('');
      const notices = d.notices.map((n) => `<li>${esc(n.text)}</li>`).join('');
      const acts = d.activities
        .filter((a) => !a.closed)
        .map((a) => `<li><a href="${esc(a.mapUrl)}">${esc(a.name)}</a> · ${esc(a.place)}</li>`)
        .join('');
      return `<section class="day">
  <p class="date">${esc(d.label)}</p>
  <h2>${esc(d.title)}</h2>
  ${d.drivingMinutes > 0 ? `<p class="stats">${esc(d.km)} km · ${esc(d.driving)}${d.departure ? ` · ${esc(d.departure)}` : ''}${d.arrival ? ` → ~${esc(d.arrival)}` : ''}${d.sunset ? ` · ☀ ${esc(d.sunset)}` : ''}</p>` : ''}
  ${timeline ? `<ul class="timeline">${timeline}</ul>` : ''}
  ${legs ? `<h3>${esc(labels.legs)}</h3><ul>${legs}</ul>` : ''}
  ${notices ? `<h3>${esc(labels.watch)}</h3><ul>${notices}</ul>` : ''}
  ${acts ? `<h3>${esc(labels.todo)}</h3><ul>${acts}</ul>` : ''}
  <p class="sleep"><b>${esc(labels.sleep)}:</b> ${d.sleep ? `${esc(d.sleep.name)} · ${esc(d.sleep.statusLabel)}` : esc(d.sleepNote ?? '')}</p>
</section>`;
    })
    .join('\n');

  const lodgingRows = lodging
    ? lodging.stops
        .map(
          (s) =>
            `<tr><td>${esc(s.placeName)}</td><td>${esc(s.dates)}</td><td class="n">${s.hosted ? '—' : esc(s.myPrice ?? s.recommendedTotal ?? '—')}</td></tr>`,
        )
        .join('')
    : '';
  const todoRows = todos
    .map(
      (t) =>
        `<li>${t.status === 'bought' ? '✓ ' : ''}${t.url ? `<a href="${esc(t.url)}">${esc(t.title)}</a>` : esc(t.title)}${
          t.due ? ` · ${esc(labels.due)} ${esc(t.due)}` : ''
        }${t.saleOpens ? ` · ${esc(t.saleOpens)}` : ''}</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${esc(labels.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(route.name)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1d2433; --muted: #5a6070; --rule: #d9d3c6; --ground: #faf8f3; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ece8df; --muted: #a9a59c; --rule: #3a3f4b; --ground: #141821; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--ground); }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 0 0 8px; }
  h3 { font-size: 14px; margin: 16px 0 4px; color: var(--muted); }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 4px 0; }
  a { color: inherit; }
  .muted, .date, .stats { color: var(--muted); }
  .date { margin: 0; font-size: 14px; }
  .day { border-top: 1px solid var(--rule); padding: 24px 0; break-inside: avoid; }
  .timeline { list-style: none; padding: 0; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td, th { text-align: left; padding: 8px 8px 8px 0; border-top: 1px solid var(--rule); }
  .n { text-align: right; }
  @media print { body { background: #fff; color: #000; } a { text-decoration: none; } .hint { display: none; } }
</style>
</head>
<body>
<main>
  <h1>${esc(route.name)}</h1>
  ${route.summary ? `<p class="muted">${esc(route.summary)}</p>` : ''}
  ${route.sacrifices ? `<p>${esc(route.sacrifices)}</p>` : ''}
  <p class="muted hint">${esc(labels.printHint)}</p>
  ${days}
  ${lodgingRows ? `<section class="day"><h2>${esc(labels.lodging)}</h2><table><tbody>${lodgingRows}</tbody></table><p class="muted">${esc(lodging?.currency ?? '')} · ${esc(labels.myPrice)}</p></section>` : ''}
  ${todoRows ? `<section class="day"><h2>${esc(labels.todos)}</h2><ul>${todoRows}</ul></section>` : ''}
  <p class="muted">${esc(labels.disclaimer)}</p>
  <p class="muted">${esc(labels.generated)}</p>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function icsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** RFC 5545 folding: lines of at most 75 octets, continued with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, 'utf8') > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function rumboIcs(
  view: RumboView,
  route: ClientRumbo,
  todos: readonly ClientTodo[],
  stamp: Date,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cifra//Rumbo//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(route.name)}`,
  ];
  const now = utc(stamp.getTime());
  for (const d of route.days) {
    const next = new Date(Date.parse(`${d.date}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const description = [
      ...d.drives
        .flatMap((dr) => dr.legs)
        .map((l) => `${l.fromName} → ${l.toName}: ${l.km} km, ~${l.duration}`),
      ...d.notices.map((n) => n.text),
      d.sleep ? `${d.sleep.name} · ${d.sleep.statusLabel}` : (d.sleepNote ?? ''),
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:rumbo-${view.trip.id}-${d.date}@cifra`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${d.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${next.replace(/-/g, '')}`,
      `SUMMARY:${icsText(d.title)}`,
      `DESCRIPTION:${icsText(description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  for (const f of view.flights) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:rumbo-flight-${f.id}@cifra`,
      `DTSTAMP:${now}`,
      `DTSTART:${utc(toInstant(f.departs))}`,
      `DTEND:${utc(toInstant(f.arrives))}`,
      `SUMMARY:${icsText(`✈ ${f.from} → ${f.to}${f.number ? ` ${f.number}` : ''}`)}`,
      'END:VEVENT',
    );
  }
  for (const t of todos) {
    if (!t.dueDate || t.status === 'bought') continue;
    const next = new Date(Date.parse(`${t.dueDate}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:rumbo-todo-${view.trip.id}-${t.key.replace(/[^a-z0-9-]/gi, '-')}@cifra`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${t.dueDate.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${next.replace(/-/g, '')}`,
      `SUMMARY:${icsText(t.title)}`,
      `DESCRIPTION:${icsText([t.reason, t.url ?? ''].filter(Boolean).join('\n'))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
