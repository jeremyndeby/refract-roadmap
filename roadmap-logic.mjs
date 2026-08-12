export const EARLIER = 'Earlier';
export const HOT_DELTA_THRESHOLD = 10;
export const CONTROVERSIAL_MIN_DOWNVOTES = 3;
export const DISCORD_DEEPLINK_TIMEOUT_MS = 850;
export const ROADMAP_VIEWS = Object.freeze(['open', 'shipped', 'timeline']);
const DAY_MS = 24 * 60 * 60 * 1000;

function titleOrder(a, b) {
  return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
}

function votes(item) {
  return Number.isFinite(item.votes) ? item.votes : 0;
}

function downvotes(item) {
  return Number.isFinite(item.downvotes) ? item.downvotes : 0;
}

function requesters(item) {
  return Number.isFinite(item.requested_by) ? item.requested_by : 0;
}

function delta(item) {
  return Number.isInteger(item.votes_7d?.delta) ? item.votes_7d.delta : null;
}

function createdAt(item) {
  return typeof item.created_at === 'string' ? item.created_at : '';
}

function releasedAt(item) {
  return typeof item.released_at === 'string' ? item.released_at : '';
}

export function discordAppThreadUrl(guildId, threadId) {
  return `discord://-/channels/${guildId}/${threadId}`;
}

export function shouldAttemptDiscordDeeplink({
  viewportWidth,
  coarsePointer = false,
  maxTouchPoints = 0,
} = {}) {
  return Number(viewportWidth) < 480 || coarsePointer || Number(maxTouchPoints) > 0;
}

export function startDiscordDeeplink({
  appUrl,
  webUrl,
  navigate,
  timeoutMs = DISCORD_DEEPLINK_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = setTimer(() => {
    timer = null;
    navigate(webUrl);
  }, timeoutMs);
  try {
    navigate(appUrl);
  } catch {
    // Unsupported custom schemes may throw synchronously; the web fallback remains armed.
  }
  return {
    cancel() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    },
  };
}

export function nextTeamNoteExpanded(expanded) {
  return expanded !== true;
}

export function nextFilterSelection(current, filter, {
  exclusiveValues = new Set(),
  exclusivePrefixes = [],
} = {}) {
  const next = new Set(current);
  if (next.delete(filter)) return next;

  if (exclusiveValues.has(filter)) {
    for (const value of exclusiveValues) next.delete(value);
  }
  for (const prefix of exclusivePrefixes) {
    if (!filter.startsWith(prefix)) continue;
    for (const value of next) {
      if (value.startsWith(prefix)) next.delete(value);
    }
  }
  next.add(filter);
  return next;
}

export function reactionPillDisplay(item, { limit = 3 } = {}) {
  const maxVisible = Math.max(0, Number.isInteger(limit) ? limit : 3);
  const hasOfficialTotal = Number.isFinite(item?.votes);
  const reactions = Array.isArray(item?.reactions)
    ? item.reactions.filter((reaction) => !hasOfficialTotal || reaction?.emoji !== '💜')
    : [];
  const visible = [];
  const voteCount = hasOfficialTotal ? Math.max(0, item.votes) : 0;

  if (voteCount > 0 && maxVisible > 0) {
    visible.push({ emoji: '💜', count: voteCount, semantic: 'primary', official: true });
  }

  const ordinarySlots = Math.max(0, maxVisible - visible.length);
  visible.push(...reactions.slice(0, ordinarySlots).map((reaction) => ({
    ...reaction,
    semantic: reaction.emoji === '💜'
      ? 'primary'
      : reaction.negative === true ? 'negative' : 'positive',
    official: false,
  })));

  return {
    visible,
    hiddenCount: Math.max(0, reactions.length - ordinarySlots),
  };
}

export async function loadMatchingReactionPayload({
  roadmapGenerationId,
  fetchPayload,
  onMismatch = () => {},
} = {}) {
  if (typeof fetchPayload !== 'function') {
    throw new TypeError('fetchPayload must be a function');
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const payload = await fetchPayload({ attempt, refetch: attempt === 2 });
    const reactionsGenerationId = typeof payload?.generation_id === 'string'
      ? payload.generation_id
      : null;
    if (
      typeof roadmapGenerationId === 'string' &&
      roadmapGenerationId.length > 0 &&
      reactionsGenerationId === roadmapGenerationId
    ) {
      return payload;
    }
    onMismatch({
      attempt,
      roadmapGenerationId: roadmapGenerationId ?? null,
      reactionsGenerationId,
    });
  }

  return null;
}

export function resolveTabSwipe({
  view,
  deltaX,
  deltaY,
  threshold = 52,
  dominance = 1.2,
} = {}) {
  const horizontal = Math.abs(Number(deltaX) || 0);
  const vertical = Math.abs(Number(deltaY) || 0);
  if (horizontal < threshold || horizontal <= vertical * dominance) return null;
  return adjacentTabView(view, deltaX < 0 ? 1 : -1);
}

export function adjacentTabView(view, direction) {
  const index = ROADMAP_VIEWS.indexOf(view);
  const target = index + Math.sign(Number(direction) || 0);
  return index >= 0 && target >= 0 && target < ROADMAP_VIEWS.length
    ? ROADMAP_VIEWS[target]
    : null;
}

export function isHot(item, threshold = HOT_DELTA_THRESHOLD) {
  const value = delta(item);
  return value !== null && value >= threshold;
}

function includesQuery(item, query, includeExcerpt = false) {
  const needle = query.trim().toLocaleLowerCase('en');
  if (!needle) return true;
  // Includes is search-only metadata. It has the same matching role as the
  // description, never outranking the title or appearing in the card UI.
  const haystack = includeExcerpt
    ? `${item.title} ${item.excerpt ?? ''} ${item.includes ?? ''}`
    : item.title;
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
export const isShippedLast7Days = (item, generatedAt) =>
  isWithinDays({ created_at: item.released_at }, generatedAt, 7);
export const isShippedLast30Days = (item, generatedAt) =>
  isWithinDays({ created_at: item.released_at }, generatedAt, 30);

export function tagBaseName(tag) {
  return String(tag ?? '')
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '')
    .trim();
}

export function hasStatus(item, status) {
  const expected = String(status).toLocaleLowerCase('en');
  return String(item?.status ?? '').toLocaleLowerCase('en') === expected;
}

export function isControversial(item) {
  return downvotes(item) >= CONTROVERSIAL_MIN_DOWNVOTES;
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
  if (item?.beat_to_it === true) {
    return { kind: 'beat', label: '✨ Beat you to it', days: null };
  }
  const created = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.created_at ?? ''))
    ? Date.parse(`${item.created_at}T00:00:00Z`)
    : NaN;
  const released = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.released_at ?? ''))
    ? Date.parse(`${item.released_at}T00:00:00Z`)
    : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(released) || released < created) return null;

  const days = Math.round((released - created) / DAY_MS);
  if (days < 14) return { kind: 'express', label: `⚡ Express · ${days}d`, days };
  if (days > 90) {
    return { kind: 'worth-wait', label: `🧘 Worth the wait · ${days}d`, days };
  }
  return { kind: 'neutral', label: `${days} days`, days };
}

export function selectOpen(items, {
  query = '',
  sort = 'popularity',
  direction = 'desc',
  controversialOrder = false,
  generatedAt,
  filters = [],
} = {}) {
  const active = new Set(filters);
  let selected = items.filter((item) => includesQuery(item, query, true));
  selected = selected.filter((item) => {
    if (active.has('controversial') && !isControversial(item)) return false;
    if (active.has('needs-love') && votes(item) !== 0) return false;
    if (active.has('last-7-days') && !isLast7Days(item, generatedAt)) return false;
    if (active.has('last-30-days') && !isLast30Days(item, generatedAt)) return false;
    for (const filter of active) {
      if (filter.startsWith('status:') && !hasStatus(item, filter.slice(7))) return false;
      if (!filter.startsWith('tag:')) continue;
      if (!item.tags.includes(filter.slice(4))) return false;
    }
    return true;
  });
  return [...selected].sort((a, b) => {
    if (controversialOrder) {
      return downvotes(b) - downvotes(a) ||
        votes(b) - votes(a) ||
        createdAt(b).localeCompare(createdAt(a)) ||
        titleOrder(a, b);
    }
    if (sort === 'date') {
      const dateOrder = createdAt(a).localeCompare(createdAt(b));
      return (direction === 'asc' ? dateOrder : -dateOrder) ||
        (direction === 'asc' ? votes(a) - votes(b) : votes(b) - votes(a)) ||
        titleOrder(a, b);
    }
    if (sort === 'hottest') {
      const aDelta = delta(a);
      const bDelta = delta(b);
      if (aDelta === null && bDelta !== null) return 1;
      if (aDelta !== null && bDelta === null) return -1;
      if (aDelta === null && bDelta === null) {
        return createdAt(b).localeCompare(createdAt(a)) || titleOrder(a, b);
      }
      const hotOrder = (aDelta ?? 0) - (bDelta ?? 0) ||
        (a.votes_7d?.percent ?? -Infinity) - (b.votes_7d?.percent ?? -Infinity) ||
        votes(a) - votes(b);
      return (direction === 'asc' ? hotOrder : -hotOrder) || titleOrder(a, b);
    }
    const popularityOrder = votes(a) - votes(b) ||
      createdAt(a).localeCompare(createdAt(b));
    return (direction === 'asc' ? popularityOrder : -popularityOrder) || titleOrder(a, b);
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

export function selectShipped(items, {
  query = '',
  sort = 'date',
  direction = 'desc',
  generatedAt,
  filters = [],
} = {}) {
  const active = new Set(filters);
  const selected = items
    .filter((item) => includesQuery(item, query, true))
    .filter((item) => {
      if (active.has('last-7-days') && !isShippedLast7Days(item, generatedAt)) return false;
      if (active.has('last-30-days') && !isShippedLast30Days(item, generatedAt)) return false;
      for (const filter of active) {
        if (filter.startsWith('tag:') && !item.tags.includes(filter.slice(4))) return false;
      }
      return true;
    });

  return [...selected].sort((a, b) => {
    if (sort === 'popularity') {
      const order = requesters(a) - requesters(b) ||
        releasedAt(a).localeCompare(releasedAt(b));
      return (direction === 'asc' ? order : -order) || titleOrder(a, b);
    }
    const aDate = releasedAt(a);
    const bDate = releasedAt(b);
    if (!aDate && bDate) return 1;
    if (aDate && !bDate) return -1;
    const order = aDate.localeCompare(bDate) || requesters(a) - requesters(b);
    return (direction === 'asc' ? order : -order) || titleOrder(a, b);
  });
}

export function globalPopularityRanks(items) {
  return new Map(
    selectOpen(items, { sort: 'popularity', direction: 'desc' })
      .map((item, index) => [item.id, index + 1]),
  );
}

export function groupShipped(items, options = {}) {
  const sort = options.sort ?? 'date';
  const selected = selectShipped(items, options);
  if (sort === 'popularity') {
    return selected.length === 0 ? [] : [{
      key: 'popularity',
      label: 'Most requested',
      earlier: false,
      ungrouped: true,
      items: selected,
    }];
  }

  const groups = new Map();
  for (const item of selected) {
    const key = item.month ?? EARLIER;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.keys()].map((key) => ({
    key,
    label: monthLabel(key === EARLIER ? null : key),
    earlier: key === EARLIER,
    ungrouped: false,
    items: groups.get(key),
  }));
}
