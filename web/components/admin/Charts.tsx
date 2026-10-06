'use client';

import { naira } from '@/lib/api';

/* ──────────────────────────────────────────────────────────────────────────
   Hand-rolled SVG charts — no chart library, so the ops dashboard ships the
   same bundle it did before and matches the Earnora palette exactly.
   ────────────────────────────────────────────────────────────────────────── */

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartPoint {
  day: string;
  [k: string]: string | number;
}

/** Round a max up to a human-looking axis top (1 / 2 / 5 × 10ⁿ). */
function niceMax(n: number): number {
  if (n <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * p;
}

function shortDay(day: string): string {
  return day.slice(5); // YYYY-MM-DD → MM-DD
}

/** Grouped bar chart — one cluster per day, one bar per series. */
export function GroupedBars({ data, series, height = 176 }: { data: ChartPoint[]; series: ChartSeries[]; height?: number }) {
  const W = 720;
  const padL = 28;
  const padR = 6;
  const padT = 10;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;

  if (data.length === 0) {
    return <p className="adm-empty"><i className="fa-solid fa-chart-column" />No data for this range yet.</p>;
  }

  const raw = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const top = niceMax(raw);
  const gw = plotW / data.length;
  const clusterPad = Math.min(3, gw * 0.14);
  const barW = Math.max(2, (gw - clusterPad * 2 - (series.length - 1)) / series.length);
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="adm-chart" role="img" aria-label="Daily activity">
      {ticks.map((t) => {
        const y = padT + plotH - t * plotH;
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e8edf5" strokeWidth={1} />
            {t > 0 && (
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
                {Math.round(top * t)}
              </text>
            )}
          </g>
        );
      })}

      {data.map((d, i) =>
        series.map((s, j) => {
          const v = Number(d[s.key]) || 0;
          const h = (v / top) * plotH;
          const x = padL + i * gw + clusterPad + j * (barW + 1);
          return (
            <rect
              key={`${i}-${s.key}`}
              x={x}
              y={padT + plotH - h}
              width={barW}
              height={Math.max(h, v > 0 ? 2 : 0)}
              rx={Math.min(2, barW / 2)}
              fill={s.color}
              opacity={v > 0 ? 1 : 0.22}
            >
              <title>{`${shortDay(d.day)} · ${s.label}: ${v}`}</title>
            </rect>
          );
        }),
      )}

      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text key={`x-${i}`} x={padL + i * gw + gw / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {shortDay(d.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="adm-legend">
      {series.map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface CategoryRow {
  category: string;
  tasks: number;
  claims: number;
  approved: number;
  pending: number;
  paid_kobo: number;
}

/** Horizontal breakdown of task types — approval progress stacked in one bar. */
export function HBars({ rows }: { rows: CategoryRow[] }) {
  if (rows.length === 0) {
    return <p className="adm-empty"><i className="fa-solid fa-list-check" />No tasks published yet.</p>;
  }
  const max = Math.max(1, ...rows.map((r) => r.claims));

  return (
    <div className="adm-cats">
      {rows.map((r) => {
        const pct = (n: number) => `${(n / max) * 100}%`;
        const rate = r.claims > 0 ? Math.round((r.approved / r.claims) * 100) : 0;
        return (
          <div className="hb" key={r.category}>
            <div className="hb-t">
              <b>{r.category.replace(/_/g, ' ')}</b>
              <span>{r.claims} claims · {rate}% approved</span>
            </div>
            <div className="hb-bar">
              <i className="a" style={{ width: pct(r.approved) }} />
              <i className="p" style={{ width: pct(r.pending) }} />
            </div>
            <div className="hb-m">
              {r.tasks} task{r.tasks === 1 ? '' : 's'} · {naira(r.paid_kobo)} paid
            </div>
          </div>
        );
      })}
    </div>
  );
}
