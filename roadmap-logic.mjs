export const EARLIER = 'Earlier';
export const HOT_DELTA_THRESHOLD = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

function titleOrder(a, b) {
  return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
}

function votes(item) {
  return Number.isFinite(item.votes) ? item.votes : 0;
}

function requesters(item) {
  return Number.isFinite(item.requested_by) ? item.requested_by : 0;
}

function delta(item) {
  return Number.isInteger(item.votes_7d?.delta) ? item.votes_7d.delta : null;
}

export function isHot(item, threshold = HOT_DELTA_THRESHOLD) {
  const value = delta(item);
  return value !== null && value >= threshold;
}

function includesQuery(item, query, includeExcerpt = false) {
  const needle = query.trim().toLocaleLowerCase('en');
  if (!needle) return true;
  const haystack = includeExcerpt ? `${item.title} ${item.excerpt ?? ''}` : item.title;
  return haystack.toLocaleLowerCase('en').includes(needle);
}

export function isThisWeek(item, generatedAt) {
  const created = Date.parse(`${item.created_at}T00:00:00Z`);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(generated)) return false;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return created <= generated && created >= generated - sevenDays;
}

export function roadmapContext({ open = [], shipped = [], generated_at: generatedAt } = {}) {
  const currentMonth = /^\d{4}-\d{2}/.exec(String(generatedAt ?? ''))?.[0] ?? '';
  return {
    shippedThisMonth: shipped.filter((item) => item.month === currentMonth).length,
    newThisWeek: open.filter((item) => isThisWeek(item, generatedAt)).length,
  };
}

export function relativeAge(value, reference = new Date()) {
  const posted = Date.parse(`${value}T00:00:00Z`);
  const now = reference instanceof Date ? reference.getTime() : Date.parse(reference);
  if (!Number.isFinite(posted) || !Number.isFinite(now)) return '';

  const days = Math.max(0, Math.floor((now - posted) / DAY_MS));
  let amount = days;
  let unit = 'day';
  if (days >= 730) {
    amount = Math.floor(days / 365.25);
    unit = 'year';
  } else if (days >= 60) {
    amount = Math.floor(days / 30.4375);
    unit = 'month';
  } else if (days >= 14) {
    amount = Math.floor(days / 7);
    unit = 'week';
  }

  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-amount, unit);
}

function discordCreatedDay(id) {
  if (!/^\d+$/.test(String(id ?? ''))) return null;
  try {
    const timestamp = Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
    const created = new Date(timestamp);
    if (!Number.isFinite(created.getTime())) return null;
    return Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  } catch {
    return null;
  }
}

export function deliveryBadge(item) {
  const created = discordCreatedDay(item?.id);
  const released = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.released_at ?? ''))
    ? Date.parse(`${item.released_at}T00:00:00Z`)
    : NaN;
  if (created === null || !Number.isFinite(released) || released < created) return null;

  const days = Math.round((released - created) / DAY_MS);
  if (days < 14) return { kind: 'express', label: '⚡ Express', days };
  if (days > 90) return { kind: 'long-haul', label: '🏆 Long haul', days };
  return null;
}

export function selectOpen(items, { query = '', sort = 'most-wanted', generatedAt } = {}) {
  let selected = items.filter((item) => includesQuery(item, query, true));
  if (sort === 'this-week') {
    selected = selected.filter((item) => isThisWeek(item, generatedAt));
  }
  return [...selected].sort((a, b) => {
    if (sort === 'oldest') {
      return a.created_at.localeCompare(b.created_at) || titleOrder(a, b);
    }
    if (sort === 'newest' || sort === 'this-week') {
      return b.created_at.localeCompare(a.created_at) || votes(b) - votes(a) || titleOrder(a, b);
    }
    if (sort === 'hottest') {
      const aDelta = delta(a);
      const bDelta = delta(b);
      if (aDelta === null && bDelta !== null) return 1;
      if (aDelta !== null && bDelta === null) return -1;
      if (aDelta === null && bDelta === null) {
        return b.created_at.localeCompare(a.created_at) || titleOrder(a, b);
      }
      return (bDelta ?? 0) - (aDelta ?? 0) ||
        (b.votes_7d?.percent ?? -Infinity) - (a.votes_7d?.percent ?? -Infinity) ||
        votes(b) - votes(a) || titleOrder(a, b);
    }
    return votes(b) - votes(a) || b.created_at.localeCompare(a.created_at) || titleOrder(a, b);
  });
}

export function monthLabel(month) {
  if (!month) return EARLIER;
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function groupShipped(items, { query = '', sort = 'by-month' } = {}) {
  const groups = new Map();
  for (const item of items.filter((entry) => includesQuery(entry, query))) {
    const key = item.month ?? EARLIER;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    if (a === EARLIER) return 1;
    if (b === EARLIER) return -1;
    return b.localeCompare(a);
  });

  return keys.map((key) => ({
    key,
    label: monthLabel(key === EARLIER ? null : key),
    earlier: key === EARLIER,
    items: groups.get(key).sort((a, b) => {
      if (sort === 'most-wanted') {
        return requesters(b) - requesters(a) || titleOrder(a, b);
      }
      return String(b.released_at ?? '').localeCompare(String(a.released_at ?? '')) ||
        requesters(b) - requesters(a) || titleOrder(a, b);
    }),
  }));
}
