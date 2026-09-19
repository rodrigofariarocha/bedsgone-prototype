/**
 * Bedsgone — single source of truth for the booking questionnaire.
 *
 * The pricing model is deliberately blunt: a flat rate that depends on one
 * thing only — whether the crew has to go inside the home or not. Mattress
 * size, type and age do not change the price, so the form never asks.
 */

export const BUSINESS = {
  name: 'Bedsgone',
  tagline: 'Pick ups & waste recycling',
  phone: '(555) 233-7891',
  phoneHref: 'tel:+15552337891',
  email: 'hello@bedsgone.com',
  hours: 'Mon–Sat, 7:00 AM – 7:00 PM',
  currency: 'USD',
} as const;

/* -------------------------------------------------------------------------- */
/* The whole price list                                                       */
/* -------------------------------------------------------------------------- */

export interface PickupSpot {
  key: string;
  label: string;
  sub: string;
  detail: string;
  price: number;
  badge?: string;
}

export const PICKUP_SPOTS: PickupSpot[] = [
  {
    key: 'outside',
    label: 'Left outside',
    sub: 'Curb, driveway, garage or front yard',
    detail: 'Leave it where the truck can reach it. Nobody needs to be home.',
    price: 70,
    badge: 'Cheapest',
  },
  {
    key: 'inside',
    label: 'Inside the home',
    sub: 'Any room, any floor, stairs included',
    detail: 'Two crew come in, wrap it and carry it out. Someone has to let us in.',
    price: 100,
  },
];

/** Every mattress after the first. Size makes no difference. */
export const EXTRA_MATTRESS = 30;

/** Same-day or next-day booking. */
export const RUSH_FEE = 25;

/** Outside the core ZIP list, but still drivable. */
export const OUT_OF_AREA_FEE = 25;

export const priceFor = (spotKey: string) =>
  PICKUP_SPOTS.find((s) => s.key === spotKey)?.price ?? PICKUP_SPOTS[0].price;

export const CHEAPEST = Math.min(...PICKUP_SPOTS.map((s) => s.price));

/* -------------------------------------------------------------------------- */
/* When                                                                       */
/* -------------------------------------------------------------------------- */

export const TIME_WINDOWS = [
  { key: '08-10', label: '8:00 – 10:00 AM', sub: 'Early crew' },
  { key: '10-12', label: '10:00 AM – 12:00 PM', sub: 'Most popular' },
  { key: '12-14', label: '12:00 – 2:00 PM', sub: 'After lunch' },
  { key: '14-16', label: '2:00 – 4:00 PM', sub: 'Afternoon' },
  { key: '16-18', label: '4:00 – 6:00 PM', sub: 'After work' },
  { key: 'allday', label: 'Any time, 8 AM – 6 PM', sub: 'Whenever suits the route' },
] as const;

export const SCHEDULING = {
  /** Bookings open this many days out (0 = today is bookable). */
  minDaysAhead: 1,
  /** How far ahead the calendar goes. */
  maxDaysAhead: 30,
  /** Sunday = 0. Days we do not run a truck. */
  closedWeekdays: [0],
  /** Picked up within this many days of booking = rush. */
  rushWithinDays: 2,
} as const;

/* -------------------------------------------------------------------------- */
/* Service area                                                               */
/* -------------------------------------------------------------------------- */

export interface Metro {
  name: string;
  state: string;
  /** 3-digit ZIP prefixes we cover. */
  prefixes: string[];
  /** Miles from the depot we will still drive. */
  radius: number;
}

export const METROS: Metro[] = [
  { name: 'New York City', state: 'NY/NJ', prefixes: ['100', '101', '102', '103', '104', '110', '111', '112', '113', '114', '116', '070', '071', '072', '073', '074'], radius: 35 },
  { name: 'Los Angeles', state: 'CA', prefixes: ['900', '901', '902', '903', '904', '905', '906', '907', '908', '910', '911', '912', '913', '917', '918'], radius: 40 },
  { name: 'Chicago', state: 'IL', prefixes: ['600', '601', '602', '603', '604', '605', '606'], radius: 35 },
  { name: 'Houston', state: 'TX', prefixes: ['770', '772', '773', '774', '775'], radius: 40 },
  { name: 'Phoenix', state: 'AZ', prefixes: ['850', '852', '853'], radius: 40 },
  { name: 'Dallas–Fort Worth', state: 'TX', prefixes: ['750', '751', '752', '753', '760', '761'], radius: 40 },
  { name: 'Miami–Fort Lauderdale', state: 'FL', prefixes: ['330', '331', '332', '333'], radius: 35 },
  { name: 'Atlanta', state: 'GA', prefixes: ['300', '301', '303', '311'], radius: 35 },
  { name: 'Seattle', state: 'WA', prefixes: ['980', '981', '984'], radius: 30 },
  { name: 'Boston', state: 'MA', prefixes: ['021', '022', '024', '019'], radius: 30 },
];

export function lookupZip(zip: string): { status: 'covered' | 'unknown'; metro?: Metro } {
  const clean = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) return { status: 'unknown' };
  const prefix = clean.slice(0, 3);
  const metro = METROS.find((m) => m.prefixes.includes(prefix));
  return metro ? { status: 'covered', metro } : { status: 'unknown' };
}

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
  'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];
