/**
 * Controlled withdrawal windows, evaluated in the platform timezone (WAT).
 * Window format: "HH:MM-HH:MM", single window per day (midnight-crossing unsupported).
 */

export interface WindowParts {
  startMin: number;
  endMin: number;
}

export function parseWindow(range: string): WindowParts {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(range.trim());
  if (!m) throw new Error(`Invalid withdrawal window "${range}", expected HH:MM-HH:MM`);
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (endMin <= startMin) throw new Error('Withdrawal window must end after it starts (no midnight crossing)');
  return { startMin, endMin };
}

interface ZonedNow {
  minutes: number; // minutes since local midnight
  dateStr: string; // YYYY-MM-DD in that timezone
  hour: number;
  minute: number;
}

/** Current wall-clock time in the given IANA timezone (defaults Africa/Lagos / WAT). */
export function nowInTz(tz: string): ZonedNow {
  return atInTz(Date.now(), tz);
}

function atInTz(ts: number, tz: string): ZonedNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === '24' ? '00' : parts.hour);
  const minute = Number(parts.minute);
  return {
    hour,
    minute,
    minutes: hour * 60 + minute,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function isWindowOpen(range: string, tz: string): boolean {
  const { startMin, endMin } = parseWindow(range);
  const now = nowInTz(tz);
  return now.minutes >= startMin && now.minutes < endMin;
}

export interface WindowStatus {
  open: boolean;
  window: string;
  timezone: string;
  now: string;
  opensAt: string | null;
  minutesUntilOpen: number | null;
}

export function windowStatus(range: string, tz: string): WindowStatus {
  const { startMin } = parseWindow(range);
  const now = nowInTz(tz);
  const open = isWindowOpen(range, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`;
  // if today's start already passed, the next slot is tomorrow
  const startPassed = startMin <= now.minutes;
  const opensDate = startPassed ? atInTz(Date.now() + 24 * 3600 * 1000, tz).dateStr : now.dateStr;
  return {
    open,
    window: range,
    timezone: tz,
    now: `${pad(now.hour)}:${pad(now.minute)}`,
    opensAt: open ? null : `${opensDate}T${hhmm}:00`,
    minutesUntilOpen: open ? 0 : startPassed ? 24 * 60 - now.minutes + startMin : startMin - now.minutes,
  };
}

/** The calendar date (YYYY-MM-DD, platform tz) a withdrawal requested now belongs to. */
export function currentWindowDate(tz: string): string {
  return nowInTz(tz).dateStr;
}
