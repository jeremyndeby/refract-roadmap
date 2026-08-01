export const EARLIER = 'Earlier';
export const HOT_DELTA_THRESHOLD = 10;
export const CONTROVERSIAL_MIN_VOTES = 5;
export const CONTROVERSIAL_MIN_DOWNVOTES = 3;
export const CONTROVERSIAL_DOWNVOTES_ONLY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function isWithinDays(item, generatedAt, days) {
  const created = Date.parse(`${item.created_at}T00:00:00Z`);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(generated)) return false;
  return created <= generated && created >= generated - days * DAY_MS;
}

export const isLast7Days = (item, generatedAt) => isWithinDays(item, generatedAt, 7);
export const isLast30Days = (item, generatedAt) => isWithinDays(item, generatedAt, 30);

export function controversialScore(item) {
  const up = votes(item);
  const down = Number.isFinite(item.downvotes) ? item.downvotes : 0;
  if (!(
    (up >= CONTROVERSIAL_MIN_VOTES && down >= CONTROVERSIAL_MIN_DOWNVOTES) ||
    down >= CONTROVERSIAL_DOWNVOTES_ONLY
  )) return null;
  const total = up + down;
  const balance = 1 - Math.abs(up - down) / total;
  return balance * Math.log2(total + 1);
}

export function roadmapContext({ open = [], shipped = [], generated_at: generatedAt } = {}) {
  return {
    newLast7Days: open.filter((item) => isLast7Days(item, generatedAt)).length,
    newLast30Days: open.filter((item) => isLast30Days(item, generatedAt)).length,
    shippedLast30Days: shipped.filter((item) =>
      isWithinDays({ created_at: item.released_at }, generatedAt, 30)).length,
  };
}

export function relativeAge(value, reference = new Date()) {
  const posted = Date.parse(`${value}T00:00:00Z`);
  const now = reference instanceof Date ? reference.getTime() : Date.parse(reference);
  if (!Number.isFinite(posted) || !Number.isFinite(now)) return '';

  const days = Math.max(0, Math.floor((now - posted) / DAY_MS));
  if (days >= 730) return `${Math.floor(days / 365.25)}y ago`;
  if (days >= 60) return `${Math.floor(days / 30.4375)}mo ago`;
  if (days >= 14) return `${Math.floor(days / 7)}w ago`;
  return `${days}d ago`;
}

export function deliveryBadge(item) {
  const created = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.created_at ?? ''))
    ? Date.parse(`${item.created_at}T00:00:00Z`)
    : NaN;
  const released = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.released_at ?? ''))
    ? Date.parse(`${item.released_at}T00:00:00Z`)
    : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(released) || released < created) return null;

  const days = Math.round((released - created) / DAY_MS);
  if (days < 14) return { kind: 'express', label: `⚡ Shipped in ${days} days`, days };
  if (days > 90) {
    return { kind: 'worth-wait', label: `🧘 Worth the wait — ${days} days`, days };
  }
  return { kind: 'neutral', label: `Shipped in ${days} days`, days };
}

export function selectOpen(items, {
  query = '',
  sort = 'popularity',
  generatedAt,
  filters = [],
} = {}) {
  const active = new Set(filters);
  let selected = items.filter((item) => includesQuery(item, query, true));
  selected = selected.filter((item) => {
    if (active.has('controversial') && controversialScore(item) === null) return false;
    if (active.has('needs-love') && votes(item) !== 0) return false;
    if (active.has('last-7-days') && !isLast7Days(item, generatedAt)) return false;
    if (active.has('last-30-days') && !isLast30Days(item, generatedAt)) return false;
    for (const filter of active) {
      if (!filter.startsWith('tag:')) continue;
      if (!item.tags.includes(filter.slice(4))) return false;
    }
    return true;
  });
  return [...selected].sort((a, b) => {
    if (sort === 'oldest') {
      return a.created_at.localeCompare(b.created_at) || titleOrder(a, b);
    }
    if (sort === 'newest') {
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
