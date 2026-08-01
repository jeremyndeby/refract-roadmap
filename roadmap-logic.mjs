export const EARLIER = 'Earlier';

function titleOrder(a, b) {
  return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
}

function votes(item) {
  return Number.isFinite(item.votes) ? item.votes : 0;
}

function requesters(item) {
  return Number.isFinite(item.requested_by) ? item.requested_by : 0;
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
