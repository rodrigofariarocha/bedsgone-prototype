/**
 * Quote engine. Pure functions — no DOM — so the same math can later run on a
 * server (or in a test) without touching the wizard.
 */

import {
  EXTRA_MATTRESS,
  OUT_OF_AREA_FEE,
  PICKUP_SPOTS,
  RUSH_FEE,
  SCHEDULING,
  TIME_WINDOWS,
  lookupZip,
  priceFor,
} from './config';

export interface Booking {
  /** How many mattresses. Size and type are never asked — they do not change
   *  the price. */
  count: number;
  /** 'outside' | 'inside' — the only answer that moves the number. */
  spot: string;

  // Where
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  accessNotes: string;

  // When
  date: string; // yyyy-mm-dd
  window: string;

  // Who
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  sms: boolean;
  notes: string;
}

export interface QuoteLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface Quote {
  lines: QuoteLine[];
  total: number;
}

export function emptyBooking(): Booking {
  return {
    count: 1,
    spot: 'outside',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    accessNotes: '',
    date: '',
    window: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    sms: true,
    notes: '',
  };
}

function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysFromToday(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function buildQuote(b: Booking): Quote {
  const lines: QuoteLine[] = [];
  const spot = PICKUP_SPOTS.find((s) => s.key === b.spot) ?? PICKUP_SPOTS[0];
  const count = Math.max(1, b.count || 1);

  lines.push({
    label: `Flat rate — ${spot.label.toLowerCase()}`,
    detail: 'Truck, crew, disposal and recycling',
    amount: priceFor(spot.key),
  });

  if (count > 1) {
    lines.push({
      label: `${count - 1} extra mattress${count > 2 ? 'es' : ''}`,
      detail: 'Any size, same price',
      amount: (count - 1) * EXTRA_MATTRESS,
    });
  }

  const date = parseLocalDate(b.date);
  if (date) {
    const lead = daysFromToday(date);
    if (lead <= SCHEDULING.rushWithinDays) {
      lines.push({
        label: 'Rush scheduling',
        detail: lead <= 0 ? 'Same day' : 'Within 48 hours',
        amount: RUSH_FEE,
      });
    }
  }

  if (b.zip.length === 5 && lookupZip(b.zip).status === 'unknown') {
    lines.push({ label: 'Extended travel', detail: 'Outside our core ZIP list', amount: OUT_OF_AREA_FEE });
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { lines, total };
}

export function money(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}$${Math.abs(amount).toFixed(0)}`;
}

/** yyyy-mm-dd for `min`/`max` on the date input. */
export function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isClosedDay(value: string): boolean {
  const d = parseLocalDate(value);
  if (!d) return false;
  return (SCHEDULING.closedWeekdays as readonly number[]).includes(d.getDay());
}

export function prettyDate(value: string): string {
  const d = parseLocalDate(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function windowLabel(key: string): string {
  return TIME_WINDOWS.find((w) => w.key === key)?.label ?? '';
}

/** The next N bookable days, for the quick-pick chips. */
export function nextAvailableDays(count: number): { value: string; weekday: string; day: string; month: string }[] {
  const out: { value: string; weekday: string; day: string; month: string }[] = [];
  let offset = SCHEDULING.minDaysAhead;
  while (out.length < count && offset <= SCHEDULING.maxDaysAhead) {
    const value = isoDay(offset);
    if (!isClosedDay(value)) {
      const d = parseLocalDate(value)!;
      out.push({
        value,
        weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
        day: String(d.getDate()),
        month: d.toLocaleDateString('en-US', { month: 'short' }),
      });
    }
    offset++;
  }
  return out;
}
