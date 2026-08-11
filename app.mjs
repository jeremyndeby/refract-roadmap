import {
  adjacentTabView,
  DISCORD_DEEPLINK_TIMEOUT_MS,
  deliveryBadge,
  discordAppThreadUrl,
  globalPopularityRanks,
  groupShipped,
  hasStatus,
  loadMatchingReactionPayload,
  nextFilterSelection,
  nextTeamNoteExpanded,
  reactionPillDisplay,
  relativeAge,
  roadmapContext,
  resolveTabSwipe,
  selectOpen,
  shouldAttemptDiscordDeeplink,
  startDiscordDeeplink,
  tagBaseName,
} from './roadmap-logic.mjs?v=9f1736d0c43b';
import { etaLabel, statusPillMarkup, timelineStatusForPost } from './eta-pill.mjs?v=3';

const DISCORD_GUILD_ID = '1490347491151970366';
const INITIAL_OPEN_ROWS = 25;
const OPEN_BATCH_SIZE = 50;
const IN_PROGRESS_STATUS = 'In Progress';
const PLANNED_STATUS = 'Planned';
const ACTIVITY_FILTERS = new Set([
  'status:In Progress',
  'status:Planned',
  'controversial',
  'needs-love',
  'last-7-days',
  'last-30-days',
]);
const DESKTOP_TAG_LIMIT = 8;
const initialPostMatch = location.hash.match(/^#post-(\d+)$/u);
let openRenderVersion = 0;
let descriptionMeasureFrame = null;
const descriptionMeasureQueue = [];

const state = {
  data: null,
  view: location.hash === '#timeline'
    ? 'timeline'
    : location.hash === '#shipped' ? 'shipped' : 'open',
  openQuery: '',
  shippedQuery: '',
  openSort: 'popularity',
  openDirection: 'desc',
  controversialOrder: false,
  openFilters: new Set(),
  openGlobalRanks: new Map(),
  openGlobalMaxVotes: 1,
  tagsExpanded: false,
  shippedSort: 'date',
  shippedDirection: 'desc',
  shippedFilters: new Set(),
  shippedTagsExpanded: false,
  openRendered: false,
  shippedRendered: false,
  timelineRendered: false,
  postTarget: null,
  pendingPostId: initialPostMatch?.[1] ?? null,
};

document.fonts?.ready.then(() => {
  performance.measure('roadmap-fonts-ready', { start: 0, end: performance.now() });
});

const elements = {
  freshness: document.querySelector('#freshness'),
  shippedLast30Days: document.querySelector('#shipped-last-30-days'),
  shippedLast30DaysDelta: document.querySelector('#shipped-last-30-days-delta'),
  newLast30Days: document.querySelector('#new-last-30-days'),
  newLast30DaysDelta: document.querySelector('#new-last-30-days-delta'),
  newLast7Days: document.querySelector('#new-last-7-days'),
  newLast7DaysDelta: document.querySelector('#new-last-7-days-delta'),
  pulseOpenTotal: document.querySelector('#pulse-open-total'),
  pulseShippedTotal: document.querySelector('#pulse-shipped-total'),
  openCount: document.querySelector('#open-count'),
  shippedCount: document.querySelector('#shipped-count'),
  openSearch: document.querySelector('#open-search'),
  shippedSearch: document.querySelector('#shipped-search'),
  mobileVotingToggle: document.querySelector('#mobile-voting-toggle'),
  votingExplanation: document.querySelector('#voting-explanation'),
  openResultCount: document.querySelector('#open-result-count'),
  shippedResultCount: document.querySelector('#shipped-result-count'),
  shippedScale: document.querySelector('#shipped-scale'),
  openList: document.querySelector('#open-list'),
  shippedList: document.querySelector('#shipped-list'),
  timelineRoot: document.querySelector('#timeline-root'),
  hottestSort: document.querySelector('[data-open-sort="hottest"]'),
  activityFilters: document.querySelector('#activity-filters'),
  tagFilters: document.querySelector('#tag-filters'),
  shippedActivityFilters: document.querySelector('#shipped-activity-filters'),
  shippedTagFilters: document.querySelector('#shipped-tag-filters'),
  sheetActivityFilters: document.querySelector('#sheet-activity-filters'),
  sheetTagFilters: document.querySelector('#sheet-tag-filters'),
  sheetOpenSorts: document.querySelector('#sheet-open-sorts'),
  sheetShippedSorts: document.querySelector('#sheet-shipped-sorts'),
  stickyToolbar: document.querySelector('#sticky-toolbar'),
  toolbarSentinel: document.querySelector('#toolbar-sentinel'),
  stickyActiveFilters: document.querySelector('#sticky-active-filters'),
  stickyClear: document.querySelector('#sticky-clear'),
  stickySearchToggle: document.querySelector('#sticky-search-toggle'),
  stickySearch: document.querySelector('#sticky-search'),
  mobileToolbar: document.querySelector('#mobile-toolbar'),
  mobileFilterOpen: document.querySelector('#mobile-filter-open'),
  mobileFilterCount: document.querySelector('#mobile-filter-count'),
  mobileSearchToggle: document.querySelector('#mobile-search-toggle'),
  mobileSearch: document.querySelector('#mobile-search'),
  shippedStickyToolbar: document.querySelector('#shipped-sticky-toolbar'),
  shippedToolbarSentinel: document.querySelector('#shipped-toolbar-sentinel'),
  shippedStickyActiveFilters: document.querySelector('#shipped-sticky-active-filters'),
  shippedStickyClear: document.querySelector('#shipped-sticky-clear'),
  shippedStickySearchToggle: document.querySelector('#shipped-sticky-search-toggle'),
  shippedStickySearch: document.querySelector('#shipped-sticky-search'),
  shippedMobileToolbar: document.querySelector('#shipped-mobile-toolbar'),
  shippedMobileFilterOpen: document.querySelector('#shipped-mobile-filter-open'),
  shippedMobileFilterCount: document.querySelector('#shipped-mobile-filter-count'),
  shippedMobileSearchToggle: document.querySelector('#shipped-mobile-search-toggle'),
  shippedMobileSearch: document.querySelector('#shipped-mobile-search'),
  filterSheet: document.querySelector('#filter-sheet'),
  filterSheetClose: document.querySelector('#filter-sheet-close'),
  filterSheetApply: document.querySelector('#filter-sheet-apply'),
  filterSheetTitle: document.querySelector('#filter-sheet-title'),
  backToTop: document.querySelector('#back-to-top'),
  main: document.querySelector('#roadmap-main'),
  tabList: document.querySelector('#roadmap-tabs'),
  tabIndicator: document.querySelector('#tab-indicator'),
  swipeHint: document.querySelector('#swipe-hint'),
  tabs: [...document.querySelectorAll('[role="tab"]')],
  panels: {
    open: document.querySelector('#view-open'),
    shipped: document.querySelector('#view-shipped'),
    timeline: document.querySelector('#view-timeline'),
  },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(url, text) {
  const node = el('a', '', text);
  node.href = url;
  node.target = '_blank';
  node.rel = 'noreferrer';
  return node;
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value.toLocaleString('en')} ${value === 1 ? singular : pluralForm}`;
}

function discordThreadUrl(id) {
  return `https://discord.com/channels/${DISCORD_GUILD_ID}/${id}`;
}

function hydrateRoadmap(data) {
  const tagNames = Array.isArray(data.tag_names) ? data.tag_names : [];
  return {
    generation_id: data.generation_id ?? null,
    generated_at: data.generated_at,
    trends_ready: data.trends_ready === true,
    periods: data.periods,
    scale: data.scale ?? null,
    timeline: data.timeline,
    reactions_file: data.reactions_file ?? null,
    tag_names: tagNames,
    open: data.open.map((item) => ({
      ...item,
      comments: item.comments ?? 0,
      created_at: item.posted,
      downvotes: item.downvotes ?? 0,
      reactions: item.reactions ?? [],
      tags: item.tags.map((index) => tagNames[index]).filter(Boolean),
      url: discordThreadUrl(item.id),
      votes_7d: Object.hasOwn(item, 'trend')
        ? item.trend === null ? null : {
          delta: item.trend[0],
          percent: item.trend[1],
          rankDelta: Number.isInteger(item.trend[2]) ? item.trend[2] : null,
        }
        : data.trends_ready ? { delta: 0, percent: 0, rankDelta: null } : null,
    })),
    shipped: data.shipped.map((item) => ({
      ...item,
      comments: item.comments ?? 0,
      created_at: item.posted ?? null,
      reactions: item.reactions ?? [],
      tags: item.tags.map((index) => tagNames[index]).filter(Boolean),
      month: item.released_at?.slice(0, 7) ?? null,
      released_at: item.released_at ?? null,
      url: item.discord_alive === true ? discordThreadUrl(item.id) : null,
    })),
  };
}

function configureHottest() {
  const enabled = state.data.trends_ready;
  for (const button of document.querySelectorAll('[data-open-sort="hottest"]')) {
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
  }
  if (!enabled && state.openSort === 'hottest') {
    state.openSort = 'popularity';
    state.openDirection = 'desc';
  }
  syncSortButtons();
}

function sortLabel(sort, direction = state.openDirection) {
  const arrow = direction === 'asc' ? '↑' : '↓';
  if (sort === 'hottest') return `🔥 Trending ${arrow}`;
  if (sort === 'date') return `Date ${arrow}`;
  return `Popularity ${arrow}`;
}

function syncSortButtons() {
  for (const button of document.querySelectorAll('[data-open-sort]')) {
    const selected = button.dataset.openSort === state.openSort && !state.controversialOrder;
    button.setAttribute('aria-pressed', String(selected));
    button.replaceChildren(sortLabel(button.dataset.openSort));
    if (button.dataset.openSort === 'hottest' && !state.data?.trends_ready) {
      button.append(el('span', 'soon-badge', 'SOON'));
    }
  }
  for (const button of document.querySelectorAll('[data-shipped-sort]')) {
    button.setAttribute('aria-pressed', String(button.dataset.shippedSort === state.shippedSort));
    button.textContent = sortLabel(button.dataset.shippedSort, state.shippedDirection);
  }
}

function setOpenSort(sort) {
  if (state.controversialOrder) {
    state.controversialOrder = false;
    state.openSort = sort;
    state.openDirection = 'desc';
  } else if (state.openSort === sort) {
    state.openDirection = state.openDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.openSort = sort;
    state.openDirection = 'desc';
  }
  syncSortButtons();
  syncFilterButtons();
  renderOpen();
}

function setShippedSort(sort) {
  if (state.shippedSort === sort) {
    state.shippedDirection = state.shippedDirection === 'desc' ? 'asc' : 'desc';
  } else {
    state.shippedSort = sort;
    state.shippedDirection = 'desc';
  }
  syncSortButtons();
  renderShipped();
}

function scheduleIdle(callback) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 120 });
  } else {
    setTimeout(() => callback({ timeRemaining: () => 0 }), 0);
  }
}

function formatDay(value) {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatFreshness(value) {
  const timestamp = Date.parse(value);
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `updated ${days}d ago`;
}

function renderContext() {
  const fallback = roadmapContext(state.data);
  const periods = state.data.periods ?? {
    new_last_7_days: { value: fallback.newLast7Days, delta: { ready: false } },
    new_last_30_days: { value: fallback.newLast30Days, delta: { ready: false } },
    shipped_last_30_days: { value: fallback.shippedLast30Days, delta: { ready: false } },
  };
  elements.pulseOpenTotal.textContent = plural(state.data.open.length, 'suggestion');
  elements.pulseShippedTotal.textContent = plural(
    state.data.shipped.length,
    'shipped',
    'shipped',
  );
  renderPeriodMetric(
    periods.new_last_30_days,
    elements.newLast30Days,
    elements.newLast30DaysDelta,
  );
  renderPeriodMetric(
    periods.new_last_7_days,
    elements.newLast7Days,
    elements.newLast7DaysDelta,
  );
  renderPeriodMetric(
    periods.shipped_last_30_days,
    elements.shippedLast30Days,
    elements.shippedLast30DaysDelta,
  );
}

function renderPeriodMetric(metric, valueNode, deltaNode) {
  valueNode.textContent = (metric?.value ?? 0).toLocaleString('en');
  const delta = metric?.delta;
  deltaNode.className = 'period-delta';
  if (!delta?.ready) {
    deltaNode.textContent = '—';
    deltaNode.setAttribute('aria-label', 'Comparison not available yet');
    return;
  }
  const direction = delta.absolute > 0 ? 'positive' : delta.absolute < 0 ? 'negative' : 'zero';
  const arrow = delta.absolute > 0 ? '↗' : delta.absolute < 0 ? '↘' : '→';
  const absolute = delta.absolute > 0 ? `+${delta.absolute}` : String(delta.absolute);
  const percent = delta.percent === null ? 'new' : `${Math.abs(delta.percent).toLocaleString('en', { maximumFractionDigits: 1 })}%`;
  deltaNode.classList.add(direction);
  deltaNode.textContent = `${arrow} ${absolute} · ${percent}`;
  deltaNode.setAttribute('aria-label', `${absolute} compared with the previous period, ${percent}`);
}

const TAG_COLORS = Object.freeze({
  Anime: { accent: '#FD79A8', text: '#FFBBD9' },
  Design: '#7BED9F',
  Discovery: '#FFEAA7',
  Feature: { accent: '#6C5CE7', text: '#C8C4FF' },
  'Import / Export': '#81ECEC',
  Movies: { accent: '#0984E3', text: '#A8D8FF' },
  Notifications: '#FDCB6E',
  'In Progress': '#FDCB6E',
  Planned: { accent: '#3498DB', text: '#A9DCFF' },
  Profile: '#55EFC4',
  Settings: '#D6A2E8',
  Social: '#00CEC9',
  Stats: '#FAB1A0',
  'TV Shows': { accent: '#E17055', text: '#FFC2AE' },
});

function tagColor(tag) {
  return TAG_COLORS[tagBaseName(tag)] ?? '#B2BEC3';
}

function statusOfTag(tag) {
  const base = tagBaseName(tag).toLocaleLowerCase('en');
  if (base === IN_PROGRESS_STATUS.toLocaleLowerCase('en')) return 'in-progress';
  if (base === PLANNED_STATUS.toLocaleLowerCase('en')) return 'planned';
  return null;
}

function displayStatusTag(tag) {
  const status = statusOfTag(tag);
  if (status === 'in-progress' && !String(tag).includes('🚧')) return `🚧 ${tagBaseName(tag)}`;
  if (status === 'planned' && !String(tag).includes('📋')) return `📋 ${tagBaseName(tag)}`;
  return tag;
}

function setChipColor(node, color) {
  const accent = typeof color === 'string' ? color : color.accent;
  const text = typeof color === 'string' ? color : color.text;
  node.style.setProperty('--chip-color', accent);
  node.style.setProperty('--chip-text', text);
  node.style.setProperty('--chip-selected', text);
}

function filtersFor(view) {
  return view === 'shipped' ? state.shippedFilters : state.openFilters;
}

function formatTrend(item) {
  const trend = item.votes_7d;
  if (!trend) {
    return {
      className: 'trend unknown',
      delta: '—',
      percent: '',
      label: '7-day change not available yet',
    };
  }
  const percent = trend.percent === null
    ? 'new'
    : `${trend.percent > 0 ? '+' : ''}${trend.percent.toLocaleString('en', { maximumFractionDigits: 1 })}%`;
  if (trend.delta > 0) {
    return {
      className: 'trend positive',
      direction: 'up',
      delta: `+${trend.delta}`,
      percent,
      label: `Gained ${trend.delta} votes in 7 days, ${percent}`,
    };
  }
  if (trend.delta < 0) {
    return {
      className: 'trend negative',
      direction: 'down',
      delta: String(trend.delta),
      percent,
      label: `Lost ${Math.abs(trend.delta)} votes in 7 days, ${percent}`,
    };
  }
  return { className: 'trend zero', delta: '0', percent: '0%', label: 'No vote change in 7 days' };
}

function trendArrow(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('trend-arrow', `trend-arrow-${direction}`);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.25 12.5C4.4 6.25 8.1 3.5 13.5 3.5M10 1.5h3.5V5');
  svg.append(path);
  return svg;
}

function createVoteTrend(item) {
  const formatted = formatTrend(item);
  const node = el('span', formatted.className);
  node.setAttribute('aria-label', formatted.label);
  if (formatted.direction) node.append(trendArrow(formatted.direction));
  node.append(el('span', 'trend-value', formatted.delta));
  if (formatted.percent) {
    node.append(
      el('span', 'trend-separator', '·'),
      el('span', 'trend-percent', formatted.percent),
    );
  }
  return node;
}

function syncFilterButtons() {
  for (const button of document.querySelectorAll('[data-roadmap-filter]')) {
    const filters = filtersFor(button.dataset.filterView);
    button.setAttribute('aria-pressed', String(filters.has(button.dataset.roadmapFilter)));
  }
  renderActiveFilterSummary();
}

function toggleFilter(filter, view = 'open') {
  const filters = filtersFor(view);
  const exclusive = view === 'open'
    ? ACTIVITY_FILTERS
    : new Set(['last-7-days', 'last-30-days']);
  const next = nextFilterSelection(filters, filter, {
    exclusiveValues: exclusive,
    exclusivePrefixes: ['tag:'],
  });
  filters.clear();
  for (const value of next) filters.add(value);
  if (view === 'open') state.controversialOrder = filters.has('controversial');
  syncFilterButtons();
  syncSortButtons();
  if (view === 'shipped') renderShipped();
  else renderOpen();
}

function createFilterChip(label, filter, color, className = '', {
  activity = false,
  view = 'open',
} = {}) {
  const button = el('button', `chip filter-chip ${className}`.trim(), label);
  button.type = 'button';
  button.dataset.roadmapFilter = filter;
  button.dataset.filterView = view;
  if (activity) button.dataset.filterKind = 'activity';
  button.setAttribute('aria-pressed', String(filtersFor(view).has(filter)));
  if (color) setChipColor(button, color);
  button.addEventListener('click', () => toggleFilter(filter, view));
  return button;
}

function filterLabel(filter) {
  const labels = {
    'status:In Progress': '🚧 In progress',
    'status:Planned': '📋 Planned',
    controversial: state.controversialOrder ? '⚡ Controversial · 👎 ↓' : '⚡ Controversial',
    'needs-love': '💜 Needs love',
    'last-7-days': '🆕 Last 7 days',
    'last-30-days': '🆕 Last 30 days',
  };
  return labels[filter] ?? filter.replace(/^tag:/, '');
}

function renderActiveFilterSummary() {
  for (const view of ['open', 'shipped']) {
    const filters = filtersFor(view);
    const fragment = document.createDocumentFragment();
    for (const filter of filters) {
      const button = el('button', 'sticky-filter', `${filterLabel(filter)} ×`);
      button.type = 'button';
      button.dataset.removeFilter = filter;
      button.addEventListener('click', () => toggleFilter(filter, view));
      fragment.append(button);
    }
    const summary = view === 'open'
      ? elements.stickyActiveFilters
      : elements.shippedStickyActiveFilters;
    const clear = view === 'open' ? elements.stickyClear : elements.shippedStickyClear;
    const count = view === 'open' ? elements.mobileFilterCount : elements.shippedMobileFilterCount;
    summary.replaceChildren(fragment);
    clear.hidden = filters.size === 0;
    count.textContent = `· ${filters.size}`;
  }
}

function reactionEmoji(emoji) {
  if (typeof emoji === 'string') return el('span', 'reaction-emoji', emoji);
  const image = document.createElement('img');
  image.className = 'reaction-emoji custom-emoji';
  image.src = `https://cdn.discordapp.com/emojis/${emoji.id}.png?size=32&quality=lossless`;
  image.alt = `:${emoji.name}:`;
  image.width = 16;
  image.height = 16;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => image.replaceWith(el('span', 'reaction-fallback', `:${emoji.name}:`)), { once: true });
  return image;
}

function createReactionRow(item, { commentsEnabled = true } = {}) {
  const display = reactionPillDisplay(item);
  if (display.visible.length === 0 && (!commentsEnabled || item.comments === 0)) {
    return null;
  }
  const row = el('div', 'reaction-row');
  for (const reaction of display.visible) {
    const pill = el('span', `reaction-pill reaction-${reaction.semantic}`);
    pill.append(reactionEmoji(reaction.emoji), el('span', '', reaction.count.toLocaleString('en')));
    row.append(pill);
  }
  if (display.hiddenCount > 0) {
    const overflow = el('span', 'reaction-overflow', `+${display.hiddenCount.toLocaleString('en')}`);
    overflow.setAttribute('aria-label', plural(display.hiddenCount, 'additional reaction'));
    row.append(overflow);
  }
  if (commentsEnabled && item.comments > 0 && item.url) {
    const comments = link(item.url, `💬 ${item.comments.toLocaleString('en')}`);
    comments.className = 'comment-pill';
    comments.setAttribute('aria-label', `${plural(item.comments, 'comment')}; open the Discord thread`);
    comments.dataset.externalHint = '↗';
    comments.dataset.discordThreadId = item.id;
    row.append(comments);
  }
  return row;
}

function createReactionSlot(item, { commentsEnabled = true } = {}) {
  const slot = el('div', 'reaction-slot');
  slot.dataset.reactionsFor = item.id;
  slot.dataset.commentsEnabled = String(commentsEnabled);
  const row = createReactionRow(item, { commentsEnabled });
  if (row) slot.append(row);
  return slot;
}

function patchReactionSlots(container, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const slot of container.querySelectorAll('.reaction-slot[data-reactions-for]')) {
    const item = byId.get(slot.dataset.reactionsFor);
    if (!item) continue;
    const row = createReactionRow(item, {
      commentsEnabled: slot.dataset.commentsEnabled !== 'false',
    });
    if (row) slot.replaceChildren(row);
    else slot.replaceChildren();
  }
}

function rankMark(rank) {
  if (rank === 1) return '🥇 #1';
  if (rank === 2) return '🥈 #2';
  if (rank === 3) return '🥉 #3';
  return `#${rank}`;
}

function createRankBadge(rank, item) {
  const badge = el('span', `rank-badge rank-badge-${rank <= 3 ? rank : 'other'}`);
  badge.append(el('span', 'rank-mark', rankMark(rank)));
  const rankDelta = item.votes_7d?.rankDelta;
  if (Number.isInteger(rankDelta) && rankDelta !== 0) {
    badge.append(el(
      'span',
      `rank-movement ${rankDelta > 0 ? 'positive' : 'negative'}`,
      `${rankDelta > 0 ? '▲' : '▼'}${Math.abs(rankDelta)}`,
    ));
  }
  badge.setAttribute('aria-label', Number.isInteger(rankDelta) && rankDelta !== 0
    ? `Popularity rank ${rank}, ${Math.abs(rankDelta)} places ${rankDelta > 0 ? 'gained' : 'lost'} in 7 days`
    : `Popularity rank ${rank}`);
  return badge;
}

function queueDescriptionMeasurement(description, copy, toggle = null) {
  descriptionMeasureQueue.push({ description, copy, toggle });
  if (descriptionMeasureFrame !== null) return;
  descriptionMeasureFrame = requestAnimationFrame(() => {
    descriptionMeasureFrame = null;
    const batch = descriptionMeasureQueue.splice(0);
    const overflows = batch.map(({ copy: text }) => text.scrollHeight > text.clientHeight + 1);
    batch.forEach(({ description: container, toggle: button }, index) => {
      const overflow = overflows[index];
      if (button) button.hidden = !overflow;
      container.classList.toggle('has-overflow', overflow);
    });
  });
}

function createDescription(text, { expandable = true } = {}) {
  const description = el('div', 'description');
  const copy = el('p', 'description-text', text);
  description.append(copy);
  if (!expandable) {
    description.classList.add('static-clamp');
    queueDescriptionMeasurement(description, copy);
    return description;
  }
  const toggle = el('button', 'description-toggle', 'Read more');
  toggle.type = 'button';
  toggle.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const expanded = description.classList.toggle('expanded');
    toggle.textContent = expanded ? 'Show less' : 'Read more';
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  description.append(toggle);
  queueDescriptionMeasurement(description, copy, toggle);
  return description;
}

function setTeamNoteExpanded(note, expanded) {
  note.classList.toggle('is-collapsed', !expanded);
  const toggle = note.querySelector('.note-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.textContent = expanded ? 'Hide ▴' : 'Show ▾';
}

function measureTeamNote(note) {
  const copy = note.querySelector('.note-copy');
  const toggle = note.querySelector('.note-toggle');
  note.classList.remove('is-short', 'is-collapsed');
  const lineHeight = Number.parseFloat(getComputedStyle(copy).lineHeight) || 22;
  const isShort = copy.scrollHeight <= lineHeight * 1.5;
  note.classList.toggle('is-short', isShort);
  toggle.hidden = isShort;
  if (isShort) {
    note.removeAttribute('role');
    note.removeAttribute('tabindex');
    setTeamNoteExpanded(note, true);
    return;
  }
  if (matchMedia('(max-width: 479px)').matches) {
    note.setAttribute('role', 'button');
    note.tabIndex = 0;
    setTeamNoteExpanded(note, false);
  } else {
    note.removeAttribute('role');
    note.removeAttribute('tabindex');
    setTeamNoteExpanded(note, true);
  }
}

function createTeamNote(text) {
  const note = el('aside', 'note team-note');
  const head = el('div', 'note-head');
  const label = el('span', 'who', '💜 FROM THE TEAM');
  const preview = el('span', 'note-preview', text);
  const toggle = el('button', 'note-toggle', 'Hide ▴');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const copy = el('p', 'note-copy', text);
  head.append(label, preview, toggle);
  note.append(head, copy);

  const toggleNote = () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    setTeamNoteExpanded(note, nextTeamNoteExpanded(expanded));
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleNote();
  });
  note.addEventListener('click', (event) => {
    if (!matchMedia('(max-width: 479px)').matches || note.classList.contains('is-short')) return;
    if (event.target.closest('button')) return;
    toggleNote();
  });
  note.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || !matchMedia('(max-width: 479px)').matches) return;
    event.preventDefault();
    toggleNote();
  });
  requestAnimationFrame(() => measureTeamNote(note));
  return note;
}

function createOpenRow(item, rank) {
  const inProgress = hasStatus(item, IN_PROGRESS_STATUS);
  const planned = hasStatus(item, PLANNED_STATUS);
  const classes = ['row'];
  if (rank === 1) classes.push('rank-first');
  else if (rank === 2) classes.push('rank-second');
  else if (rank === 3) classes.push('rank-third');
  else {
    if (rank <= 10) classes.push('rank-top10');
    if (inProgress) classes.push('in-progress');
    else if (planned) classes.push('planned');
  }
  const article = el('article', classes.join(' '));
  article.id = `roadmap-post-${item.id}`;
  article.tabIndex = -1;
  article.dataset.rank = String(rank);
  article.append(createRankBadge(rank, item));
  const taggedStatus = inProgress ? IN_PROGRESS_STATUS : planned ? PLANNED_STATUS : null;
  const status = taggedStatus ?? (etaLabel(item.eta)
    ? timelineStatusForPost(state.data.timeline, item.id)
    : null);
  if (status) {
    article.insertAdjacentHTML('beforeend', statusPillMarkup({ status, eta: item.eta }));
  }

  const voteBlock = el('div', 'votes');
  voteBlock.setAttribute('aria-label', plural(item.votes, 'vote'));
  const voteNumber = el('div', 'n');
  voteNumber.append(
    el('span', '', item.votes.toLocaleString('en')),
    el('span', 'vote-heart', '💜'),
  );
  voteBlock.append(voteNumber, el('span', 'vote-label', 'VOTES'));
  const prism = el('div', 'prism');
  prism.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  fill.style.width = `${Math.max(0, Math.min(100, (item.votes / state.openGlobalMaxVotes) * 100))}%`;
  prism.append(fill);
  voteBlock.append(prism, createVoteTrend(item), el('span', 'trend-period', 'LAST 7 DAYS'));

  const body = el('div', 'body');
  const heading = el('h2');
  heading.append(link(item.url, item.title));
  body.append(heading, createDescription(item.excerpt));

  const meta = el('div', 'meta');
  const age = item.created_at ? relativeAge(item.created_at, state.data.generated_at) : '';
  const posted = `posted ${formatDay(item.created_at)}${age ? ` · ${age}` : ''}`;
  meta.append(el('span', '', posted), el('span', 'meta-separator', '·'));
  const voteLink = link(item.url, 'Vote on Discord ↗');
  voteLink.className = 'meta-action';
  voteLink.dataset.discordThreadId = item.id;
  meta.append(voteLink);
  body.append(meta);

  body.append(createReactionSlot(item));

  const chips = el('div', 'chips');
  const orderedTags = [...item.tags].sort((a, b) =>
    Number(Boolean(statusOfTag(b))) - Number(Boolean(statusOfTag(a))) ||
    Number(statusOfTag(b) === 'in-progress') - Number(statusOfTag(a) === 'in-progress'),
  );
  for (const tag of orderedTags) {
    if (tagBaseName(tag) === 'From App' || statusOfTag(tag)) continue;
    chips.append(createFilterChip(displayStatusTag(tag), `tag:${tag}`, tagColor(tag)));
  }
  body.append(chips);

  article.append(voteBlock, body);
  if (item.note) article.append(createTeamNote(item.note));
  return article;
}

function createEmptyState({ title, detail, input, clear }) {
  const section = el('section', 'empty-state');
  section.setAttribute('role', 'status');
  section.append(
    el('span', 'empty-mark', 'No matches'),
    el('h2', '', title),
    el('p', '', detail),
  );
  if (input.value) {
    const button = el('button', 'empty-clear', 'Clear search');
    button.type = 'button';
    button.addEventListener('click', () => {
      input.value = '';
      clear();
      input.focus();
    });
    section.append(button);
  }
  return section;
}

function renderOpen() {
  const renderStarted = performance.now();
  const version = ++openRenderVersion;
  state.openRendered = false;
  const items = selectOpen(state.data.open, {
    query: state.openQuery,
    sort: state.openSort,
    direction: state.openDirection,
    controversialOrder: state.controversialOrder,
    generatedAt: state.data.generated_at,
    filters: state.openFilters,
  });
  if (items.length === 0) {
    const fragment = document.createDocumentFragment();
    const query = state.openQuery.trim();
    fragment.append(createEmptyState({
      title: query || state.openFilters.size ? 'No suggestions found' : 'No open suggestions yet',
      detail: query
        ? `Nothing matched “${query}”. Try another word or clear the search.`
        : state.openFilters.size ? 'No suggestion matches all active filters.' : 'There are no open suggestions to show yet.',
      input: elements.openSearch,
      clear: () => {
        state.openQuery = '';
        renderOpen();
      },
    }));
    elements.openList.replaceChildren(fragment);
    elements.openList.setAttribute('aria-busy', 'false');
    state.openRendered = true;
  } else {
    const initial = document.createDocumentFragment();
    const initialEnd = state.postTarget?.view === 'open'
      ? items.length
      : Math.min(INITIAL_OPEN_ROWS, items.length);
    for (let index = 0; index < initialEnd; index++) {
      initial.append(createOpenRow(items[index], state.openGlobalRanks.get(items[index].id)));
    }
    elements.openList.replaceChildren(initial);
    elements.openList.setAttribute('aria-busy', String(initialEnd < items.length));
    if (state.postTarget?.view === 'open') requestAnimationFrame(scrollToRoadmapPost);

    let cursor = initialEnd;
    const appendBatch = () => {
      if (version !== openRenderVersion) return;
      const fragment = document.createDocumentFragment();
      const end = Math.min(cursor + OPEN_BATCH_SIZE, items.length);
      for (; cursor < end; cursor++) {
        fragment.append(createOpenRow(items[cursor], state.openGlobalRanks.get(items[cursor].id)));
      }
      elements.openList.append(fragment);
      if (cursor < items.length) {
        scheduleIdle(appendBatch);
      } else {
        elements.openList.setAttribute('aria-busy', 'false');
        state.openRendered = true;
        if (!performance.getEntriesByName('roadmap-render-open-complete').length) {
          performance.measure('roadmap-render-open-complete', {
            start: renderStarted,
            end: performance.now(),
          });
        }
      }
    };
    if (cursor < items.length) scheduleIdle(appendBatch);
    else state.openRendered = true;
  }
  const suffix = state.openFilters.size ? ` · ${plural(state.openFilters.size, 'active filter')}` : '';
  elements.openResultCount.textContent = `${plural(items.length, 'suggestion')}${suffix}`;
  if (state.view === 'open') elements.filterSheetApply.textContent = `Show ${plural(items.length, 'suggestion')}`;
  if (!performance.getEntriesByName('roadmap-render-open').length) {
    performance.measure('roadmap-render-open', { start: renderStarted, end: performance.now() });
  }
}

function createShippedRow(item, maxVotes) {
  const article = el('article', `row shipped-card${item.discord_alive ? '' : ' archived-card'}`);
  article.id = `roadmap-post-${item.id}`;
  article.tabIndex = -1;
  const delivery = deliveryBadge(item);
  if (delivery) {
    const badge = el('span', `edge-badge delivery-badge delivery-badge-${delivery.kind}`, delivery.label);
    badge.title = delivery.kind === 'beat'
      ? 'This feature was already in the app before the suggestion was posted'
      : `${delivery.days} days from suggestion to release`;
    article.append(badge);
  }
  const votes = Number.isInteger(item.requested_by) ? item.requested_by : 0;
  const voteBlock = el('div', 'votes');
  voteBlock.setAttribute('aria-label', plural(votes, 'request'));
  const voteNumber = el('div', 'n');
  voteNumber.append(
    el('span', '', votes.toLocaleString('en')),
    el('span', 'vote-heart', '💜'),
  );
  const prism = el('div', 'prism');
  prism.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  fill.style.width = `${Math.max(0, Math.min(100, (votes / maxVotes) * 100))}%`;
  prism.append(fill);
  voteBlock.append(voteNumber, prism);

  const body = el('div', 'body');
  const heading = el('h2');
  if (item.discord_alive && item.url) {
    const titleLink = link(item.url, '');
    titleLink.className = 'shipped-title-link';
    titleLink.dataset.discordThreadId = item.id;
    titleLink.append(
      document.createTextNode(`${item.title} `),
      el('span', 'shipped-title-link-mark', '↗'),
    );
    heading.append(titleLink);
  } else {
    heading.append(el('span', '', item.title));
  }
  body.append(heading, createDescription(item.excerpt));

  const meta = el('div', 'meta');
  const metaParts = [];
  if (item.beat_to_it && item.created_at) {
    metaParts.push(el('span', '', `posted ${formatDay(item.created_at)}`));
    const since = el('span', 'version-meta');
    since.append(document.createTextNode('in the app since '));
    if (item.build) {
      const buildChip = el('span', 'version-chip version-chip-build', item.build);
      buildChip.title = `Build ${item.build}`;
      buildChip.setAttribute('aria-label', `Build ${item.build}`);
      since.append(buildChip);
    } else if (item.cycle) {
      const cycleChip = el('span', 'version-chip', item.cycle);
      cycleChip.title = `Cycle ${item.cycle}`;
      cycleChip.setAttribute('aria-label', `Cycle ${item.cycle}`);
      since.append(cycleChip);
    }
    metaParts.push(since);
  } else if (item.created_at) {
    const age = relativeAge(item.created_at, state.data.generated_at);
    metaParts.push(el('span', '', `posted ${formatDay(item.created_at)}${age ? ` · ${age}` : ''}`));
  }
  if (!item.beat_to_it && item.released_at) {
    const shipped = el('span', 'version-meta');
    shipped.append(document.createTextNode(`shipped ${formatDay(item.released_at)}`));
    if (item.cycle) {
      const cycleChip = el('span', 'version-chip', item.cycle);
      cycleChip.title = `Cycle ${item.cycle}`;
      cycleChip.setAttribute('aria-label', `Cycle ${item.cycle}`);
      shipped.append(cycleChip);
    }
    if (item.build) {
      const build = el('span', 'version-build', item.build);
      build.title = `Build ${item.build}`;
      build.setAttribute('aria-label', `Build ${item.build}`);
      shipped.append(build);
    }
    metaParts.push(shipped);
  }
  if (!item.discord_alive) {
    metaParts.push(el('span', 'archived-chip meta-archived', '📦 Archived'));
  }
  metaParts.forEach((part, index) => {
    if (index > 0) meta.append(el('span', 'meta-separator', '·'));
    meta.append(part);
  });
  if (meta.childNodes.length > 0) body.append(meta);

  body.append(createReactionSlot(item, { commentsEnabled: item.discord_alive }));

  const chips = el('div', 'chips');
  for (const tag of item.tags) {
    const chip = el('span', 'chip', tag);
    setChipColor(chip, tagColor(tag));
    chips.append(chip);
  }
  body.append(chips);
  article.append(voteBlock, body);
  if (item.note) article.append(createTeamNote(item.note));
  return article;
}

function createShippedGroup(group, maxVotes) {
  const section = el('section', `release${group.earlier ? ' earlier' : ''}`);
  section.setAttribute('aria-labelledby', `release-${group.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  const heading = el('h2', 'release-head');
  const label = el('span', 'month', group.label);
  label.id = `release-${group.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const detail = group.earlier
    ? `${plural(group.items.length, 'feature')} · exact delivery dates unavailable`
    : plural(group.items.length, 'feature');
  heading.append(label, el('span', 'detail', detail));
  section.append(heading);

  for (const item of group.items) section.append(createShippedRow(item, maxVotes));
  return section;
}

function renderShipped() {
  const renderStarted = performance.now();
  const groups = groupShipped(state.data.shipped, {
    query: state.shippedQuery,
    sort: state.shippedSort,
    direction: state.shippedDirection,
    generatedAt: state.data.generated_at,
    filters: state.shippedFilters,
  });
  const fragment = document.createDocumentFragment();
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const maxVotes = Math.max(1, ...state.data.shipped.map((item) => item.requested_by ?? 0));
  for (const group of groups) fragment.append(createShippedGroup(group, maxVotes));
  if (total === 0) {
    const query = state.shippedQuery.trim();
    fragment.append(createEmptyState({
      title: 'No shipped features found',
      detail: query
        ? `Nothing matched “${query}”. Try another word or clear the search.`
        : 'No shipped features match this view yet.',
      input: elements.shippedSearch,
      clear: () => {
        state.shippedQuery = '';
        renderShipped();
      },
    }));
  }
  elements.shippedList.replaceChildren(fragment);
  elements.shippedList.setAttribute('aria-busy', 'false');
  if (state.postTarget?.view === 'shipped') requestAnimationFrame(scrollToRoadmapPost);
  const suffix = state.shippedFilters.size
    ? ` · ${plural(state.shippedFilters.size, 'active filter')}`
    : '';
  elements.shippedResultCount.textContent = `${plural(total, 'shipped feature')}${suffix}`;
  renderShippedScale();
  if (state.view === 'shipped') elements.filterSheetApply.textContent = `Show ${plural(total, 'shipped feature')}`;
  state.shippedRendered = true;
  if (!performance.getEntriesByName('roadmap-render-shipped').length) {
    performance.measure('roadmap-render-shipped', { start: renderStarted, end: performance.now() });
  }
}

function renderShippedScale() {
  const scale = state.data.scale;
  if (!scale || !Number.isInteger(scale.classified_items) || !Number.isInteger(scale.builds)) {
    elements.shippedScale.hidden = true;
    elements.shippedScale.replaceChildren();
    return;
  }
  const improvements = Math.floor(scale.classified_items / 10) * 10;
  const builds = Math.floor(scale.builds / 10) * 10;
  elements.shippedScale.replaceChildren(
    document.createTextNode('…and that’s just community suggestions: '),
    el('strong', '', `${improvements.toLocaleString('en')}+ improvements`),
    document.createTextNode(' shipped across '),
    el('strong', '', `${builds.toLocaleString('en')}+ builds`),
    document.createTextNode(' since March'),
  );
  elements.shippedScale.hidden = false;
}

function createTimelineGoal(goal) {
  const section = el('section', 'timeline-goal');
  section.setAttribute('aria-label', 'Refract Pro community goal');
  const head = el('div', 'timeline-goal-head');
  head.append(
    el('strong', '', goal.title),
    el('span', 'timeline-goal-value', goal.value),
  );
  const progress = el('div', 'timeline-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', goal.title);
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(goal.progress_percent));
  const fill = el('div', 'timeline-progress-fill');
  fill.style.width = `${goal.progress_percent}%`;
  progress.append(fill);
  section.append(head, progress, el('p', 'timeline-goal-caption', goal.caption));
  return section;
}

function createTimelineHeading(node) {
  const head = el('div', 'timeline-version-head');
  head.append(el('h2', 'timeline-version-title', node.title));
  if (node.badge) {
    head.append(el('span', `timeline-version-badge timeline-version-badge-${node.badge.kind}`, node.badge.label));
  }
  if (node.meta) head.append(el('span', 'timeline-version-meta', node.meta));
  return head;
}

function createTimelinePostLink(item) {
  if (!item.post) return el('span', '', item.title);
  const anchor = el('a', 'timeline-item-link');
  anchor.href = `#post-${item.post.id}`;
  anchor.dataset.roadmapPostId = item.post.id;
  anchor.dataset.roadmapView = item.post.view;
  anchor.append(
    document.createTextNode(`${item.title} `),
    el('span', 'timeline-item-link-mark', '↗'),
  );
  return anchor;
}

function createTimelineItem(item) {
  const row = el('div', 'timeline-item');
  row.append(el('span', 'timeline-item-emoji', item.emoji));
  const name = el('span', 'timeline-item-name');
  name.append(createTimelinePostLink(item));
  row.append(name);
  if (item.pick) row.append(el('span', 'timeline-pick', item.pick));
  if (item.delay) row.append(el('span', 'timeline-delay', item.delay));
  row.append(el('span', `timeline-status timeline-status-${item.status.kind}`, item.status.label));
  return row;
}

function createTimelineVersionNode(node) {
  const article = el('article', `timeline-node timeline-node-${node.tone}`);
  article.dataset.timelineNode = node.id;
  article.append(createTimelineHeading(node));
  const card = el('div', `timeline-card${node.card_style === 'dim' ? ' timeline-card-dim' : ''}`);
  for (const item of node.items) card.append(createTimelineItem(item));
  for (const note of node.notes ?? []) card.append(el('p', 'timeline-card-note', note));
  if (node.summary) {
    const summary = el('p', 'timeline-card-note');
    summary.append(document.createTextNode(node.summary.prefix), el('strong', '', node.summary.strong));
    card.append(summary);
  }
  if (node.banner) {
    const banner = el('div', 'timeline-vote-banner');
    const anchor = link(node.banner.link_url, node.banner.link_label);
    anchor.className = 'timeline-vote-banner-link';
    banner.append(document.createTextNode(node.banner.prefix), anchor);
    card.append(banner);
  }
  if (node.feature_summary) {
    card.append(el(
      'p',
      'timeline-feature-summary',
      `…and ${node.feature_summary.more.toLocaleString('en')} more features shipped this cycle`,
    ));
  }
  if (node.quick_win) card.append(el('p', 'timeline-quick-win', node.quick_win));
  article.append(card);
  return article;
}

function appendOutcome(container, sections) {
  for (const section of sections) {
    container.append(document.createTextNode(section.label));
    section.items.forEach((item, index) => {
      if (index > 0) container.append(document.createTextNode(', '));
      container.append(el('strong', '', item));
    });
  }
}

function createTimelineVoteResult(entry, index, maximum) {
  const result = el('div', `timeline-vote-result${index >= 3 ? ' timeline-vote-result-dim' : ''}`);
  result.dataset.voteResult = String(index);
  const label = el('div', 'timeline-vote-result-label');
  label.append(
    el('span', 'timeline-vote-result-name', `${entry.medal ? `${entry.medal} ` : ''}${entry.title}`),
    el('span', 'timeline-vote-result-value', `${entry.votes} · ${entry.percent}%`),
  );
  const bar = el('div', 'timeline-vote-bar');
  const fill = el('div', `timeline-vote-bar-fill${index >= 3 ? ' timeline-vote-bar-fill-dim' : ''}`);
  fill.style.width = `${Math.max(0, Math.min(100, (entry.votes / maximum) * 100))}%`;
  bar.append(fill);
  result.append(label, bar);
  return result;
}

function setTimelineVoteExpanded(card, expanded) {
  const results = [...card.querySelectorAll('[data-vote-result]')];
  for (const result of results) {
    result.hidden = !expanded && Number(result.dataset.voteResult) >= 4;
  }
  const toggle = card.querySelector('[data-vote-toggle]');
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.textContent = expanded ? 'Collapse ▴' : `${Math.max(0, results.length - 4)} more ▾`;
  card.classList.toggle('is-expanded', expanded);
}

function createTimelineWhy(why) {
  const aside = el('aside', 'timeline-why');
  aside.append(el('span', 'timeline-why-label', why.label));
  const copy = el('p');
  for (const part of why.parts) {
    copy.append(part.strong ? el('strong', '', part.text) : document.createTextNode(part.text));
  }
  aside.append(copy);
  return aside;
}

function createTimelineVoteNode(node) {
  const article = el('article', 'timeline-node timeline-node-vote');
  article.dataset.timelineNode = node.id;
  const card = el('div', 'timeline-vote-card');
  const head = el('div', 'timeline-vote-head');
  head.append(
    el('h2', 'timeline-vote-title', node.title),
    el('span', 'timeline-vote-meta', node.meta),
  );
  card.append(head);
  const outcome = el('p', 'timeline-vote-outcome');
  appendOutcome(outcome, node.outcome);
  card.append(outcome);
  if (node.open_url) {
    const cta = link(node.open_url, node.open_label);
    cta.className = 'timeline-vote-open';
    card.append(cta);
  } else {
    const results = el('div', 'timeline-vote-results');
    const maximum = Math.max(1, ...node.entries.map((entry) => entry.votes));
    node.entries.forEach((entry, index) => results.append(createTimelineVoteResult(entry, index, maximum)));
    card.append(results);
    const toggle = el('button', 'timeline-vote-toggle');
    toggle.type = 'button';
    toggle.dataset.voteToggle = node.id;
    toggle.setAttribute('aria-controls', `timeline-results-${node.id}`);
    results.id = `timeline-results-${node.id}`;
    toggle.addEventListener('click', () => {
      setTimelineVoteExpanded(card, toggle.getAttribute('aria-expanded') !== 'true');
    });
    card.append(toggle);
    setTimelineVoteExpanded(card, false);
  }
  if (node.note) card.append(el('p', 'timeline-vote-note', node.note));
  if (node.why) card.append(createTimelineWhy(node.why));
  article.append(card);
  return article;
}

function createTimelineMilestoneNode(node) {
  const article = el('article', 'timeline-node timeline-node-old timeline-node-milestone');
  article.dataset.timelineNode = node.id;
  const head = el('div', 'timeline-version-head');
  head.append(
    el('h2', 'timeline-version-title', node.title),
    el('span', 'timeline-version-meta', node.date),
  );
  const card = el('div', `timeline-card${node.card_style === 'dim' ? ' timeline-card-dim' : ''}`);
  card.append(el('p', 'timeline-origin-intro', node.intro));
  if (node.quote) card.append(el('p', 'timeline-origin-quote', node.quote));
  if (node.era) {
    const era = el('p', 'timeline-origin-era');
    era.append(document.createTextNode(node.era.prefix));
    const strong = el('strong');
    node.era.items.forEach((item, index) => {
      if (index > 0) strong.append(document.createTextNode(' · '));
      strong.append(item.italic ? el('em', '', item.text) : document.createTextNode(item.text));
    });
    era.append(strong, document.createTextNode(node.era.suffix));
    card.append(era);
  }
  if (node.link) {
    const anchor = link(node.link.url, node.link.label);
    anchor.className = 'timeline-origin-link';
    card.append(anchor);
  }
  article.append(head, card);
  return article;
}

function createTimelineNode(node) {
  if (node.type === 'version') return createTimelineVersionNode(node);
  if (node.type === 'vote') return createTimelineVoteNode(node);
  return createTimelineMilestoneNode(node);
}

function renderTimeline() {
  const renderStarted = performance.now();
  const fragment = document.createDocumentFragment();
  fragment.append(createTimelineGoal(state.data.timeline.goal));
  const timeline = el('div', 'timeline');
  for (const year of state.data.timeline.years) {
    const label = el('div', `timeline-year-label timeline-year-label-${year.tone}`);
    label.append(el('span', 'timeline-year-tag', String(year.year)));
    timeline.append(label);
    const segment = el('section', `timeline-segment timeline-segment-${year.tone}`);
    segment.setAttribute('aria-label', String(year.year));
    segment.append(el('span', 'timeline-segment-line'));
    for (const node of year.nodes) segment.append(createTimelineNode(node));
    timeline.append(segment);
  }
  fragment.append(timeline);
  elements.timelineRoot.replaceChildren(fragment);
  elements.timelineRoot.setAttribute('aria-busy', 'false');
  state.timelineRendered = true;
  if (!performance.getEntriesByName('roadmap-render-timeline').length) {
    performance.measure('roadmap-render-timeline', { start: renderStarted, end: performance.now() });
  }
}

function scrollToRoadmapPost() {
  const target = state.postTarget;
  if (!target) return;
  const article = document.querySelector(`#roadmap-post-${CSS.escape(target.id)}`);
  if (!article) return;
  state.postTarget = null;
  article.classList.add('roadmap-post-target');
  article.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  });
  article.focus({ preventScroll: true });
  setTimeout(() => article.classList.remove('roadmap-post-target'), 1800);
}

function openTimelinePost(anchor) {
  const view = anchor.dataset.roadmapView;
  const id = anchor.dataset.roadmapPostId;
  if (!state.data || !['open', 'shipped'].includes(view) || !id) return;
  state.postTarget = { view, id };
  if (view === 'open') {
    state.openQuery = '';
    state.openFilters.clear();
    state.controversialOrder = false;
    for (const input of [elements.openSearch, elements.stickySearch, elements.mobileSearch]) {
      input.value = '';
    }
    showView('open');
    renderOpen();
  } else {
    state.shippedQuery = '';
    state.shippedFilters.clear();
    for (const input of [
      elements.shippedSearch,
      elements.shippedStickySearch,
      elements.shippedMobileSearch,
    ]) input.value = '';
    showView('shipped');
    renderShipped();
  }
  syncFilterButtons();
  history.replaceState(null, '', `#post-${id}`);
}

function appendFilterDefinitions(container, definitions, view) {
  const fragment = document.createDocumentFragment();
  for (const [label, filter] of definitions) {
    fragment.append(createFilterChip(
      label,
      filter,
      { accent: '#B2BEC3', text: '#DFE6E9' },
      'activity-chip',
      { activity: true, view },
    ));
  }
  container.replaceChildren(fragment);
}

function appendTagDefinitions(container, view, { expanded = true, withMore = false } = {}) {
  const publicTags = state.data.tag_names.filter((tag) => !statusOfTag(tag));
  const fragment = document.createDocumentFragment();
  publicTags.forEach((tag, index) => {
    const chip = createFilterChip(tag, `tag:${tag}`, tagColor(tag), '', { view });
    if (!expanded && index >= DESKTOP_TAG_LIMIT) chip.classList.add('tag-overflow');
    fragment.append(chip);
  });
  if (withMore && publicTags.length > DESKTOP_TAG_LIMIT) {
    const remaining = publicTags.length - DESKTOP_TAG_LIMIT;
    const more = el('button', 'chip tag-more', expanded ? 'Show less' : `+ ${remaining} more`);
    more.type = 'button';
    more.addEventListener('click', () => {
      if (view === 'shipped') state.shippedTagsExpanded = !state.shippedTagsExpanded;
      else state.tagsExpanded = !state.tagsExpanded;
      configureFilters();
    });
    fragment.append(more);
  }
  container.replaceChildren(fragment);
}

function configureSheetFilters() {
  const shipped = state.view === 'shipped';
  elements.sheetOpenSorts.hidden = shipped;
  elements.sheetShippedSorts.hidden = !shipped;
  const definitions = shipped
    ? [['🆕 Last 7 days', 'last-7-days'], ['🆕 Last 30 days', 'last-30-days']]
    : [
      ['🚧 In progress', 'status:In Progress'],
      ['📋 Planned', 'status:Planned'],
      ['⚡ Controversial', 'controversial'],
      ['💜 Needs love', 'needs-love'],
      ['🆕 Last 7 days', 'last-7-days'],
      ['🆕 Last 30 days', 'last-30-days'],
    ];
  appendFilterDefinitions(elements.sheetActivityFilters, definitions, state.view);
  appendTagDefinitions(elements.sheetTagFilters, state.view);
  elements.filterSheetTitle.textContent = shipped ? 'Sort & Filter Shipped' : 'Sort & Filter Open';
  syncFilterButtons();
}

function configureFilters() {
  const openActivityDefinitions = [
    ['🚧 In progress', 'status:In Progress'],
    ['📋 Planned', 'status:Planned'],
    ['⚡ Controversial', 'controversial'],
    ['💜 Needs love', 'needs-love'],
    ['🆕 Last 7 days', 'last-7-days'],
    ['🆕 Last 30 days', 'last-30-days'],
  ];
  const shippedActivityDefinitions = [
    ['🆕 Last 7 days', 'last-7-days'],
    ['🆕 Last 30 days', 'last-30-days'],
  ];
  appendFilterDefinitions(elements.activityFilters, openActivityDefinitions, 'open');
  appendFilterDefinitions(elements.shippedActivityFilters, shippedActivityDefinitions, 'shipped');
  appendTagDefinitions(elements.tagFilters, 'open', { expanded: state.tagsExpanded, withMore: true });
  appendTagDefinitions(elements.shippedTagFilters, 'shipped', {
    expanded: state.shippedTagsExpanded,
    withMore: true,
  });
  configureSheetFilters();
  syncFilterButtons();
}

async function loadDeferredReactions(file) {
  const started = performance.now();
  const payload = await loadMatchingReactionPayload({
    roadmapGenerationId: state.data.generation_id,
    fetchPayload: async ({ refetch }) => {
      const cacheBust = refetch
        ? `?generation-retry=${encodeURIComponent(state.data.generation_id ?? 'missing')}`
        : '';
      const response = await fetch(`./${file}${cacheBust}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Reaction data HTTP ${response.status}`);
      return response.json();
    },
    onMismatch: (details) => console.warn(
      '[roadmap] Asset generation mismatch; custom reaction pills withheld.',
      details,
    ),
  });
  if (!payload) {
    performance.measure('roadmap-reactions-load', { start: started, end: performance.now() });
    return;
  }
  const reactions = payload?.reactions ?? {};
  for (const item of state.data.open) item.reactions = reactions[item.id] ?? [];
  for (const item of state.data.shipped) item.reactions = reactions[item.id] ?? [];
  performance.measure('roadmap-reactions-load', { start: started, end: performance.now() });
  patchReactionSlots(elements.openList, state.data.open);
  patchReactionSlots(elements.shippedList, state.data.shipped);
}

function showView(view, { focus = false, updateHash = true } = {}) {
  state.view = view;
  for (const tab of elements.tabs) {
    const selected = tab.dataset.view === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const [name, panel] of Object.entries(elements.panels)) panel.hidden = name !== view;
  if (state.data && view === 'open' && !state.openRendered) renderOpen();
  if (state.data && view === 'shipped' && !state.shippedRendered) renderShipped();
  if (state.data && view === 'timeline' && !state.timelineRendered) renderTimeline();
  if (state.data) {
    configureSheetFilters();
    syncSortButtons();
  }
  if (updateHash) {
    history.replaceState(
      null,
      '',
      view === 'timeline'
        ? '#timeline'
        : view === 'shipped' ? '#shipped' : location.pathname + location.search,
    );
  }
  requestAnimationFrame(() => positionTabIndicator(view));
}

function positionTabIndicator(fromView = state.view, toView = null, progress = 0) {
  const from = elements.tabs.find((tab) => tab.dataset.view === fromView);
  const to = elements.tabs.find((tab) => tab.dataset.view === toView) ?? from;
  if (!from || !to) return;
  const inset = 10;
  const amount = Math.max(0, Math.min(1, progress));
  const fromLeft = from.offsetLeft + inset;
  const toLeft = to.offsetLeft + inset;
  const fromWidth = Math.max(0, from.offsetWidth - inset * 2);
  const toWidth = Math.max(0, to.offsetWidth - inset * 2);
  elements.tabIndicator.style.left = `${fromLeft + (toLeft - fromLeft) * amount}px`;
  elements.tabIndicator.style.width = `${fromWidth + (toWidth - fromWidth) * amount}px`;
  elements.tabIndicator.classList.add('is-ready');
}

function installTabSwipe() {
  const hintKey = 'refract-roadmap-swipe-hint-v1';
  const storage = {
    read() {
      try { return Number(localStorage.getItem(hintKey) ?? 0); } catch { return 3; }
    },
    write(value) {
      try { localStorage.setItem(hintKey, String(value)); } catch { /* Storage can be disabled. */ }
    },
  };
  if (window.innerWidth < 480) {
    const visits = storage.read();
    if (visits < 3) {
      elements.swipeHint.hidden = false;
      storage.write(visits + 1);
    }
  }

  let gesture = null;
  const excluded = '.toolbar, .sticky-toolbar, .mobile-toolbar, .filters, .sorts, .filter-sheet, input, button, a';
  const reset = () => {
    gesture = null;
    elements.tabList.classList.remove('is-dragging');
    positionTabIndicator(state.view);
  };
  elements.main.addEventListener('pointerdown', (event) => {
    if (window.innerWidth >= 480 || !['touch', 'pen'].includes(event.pointerType)) return;
    if (event.target.closest(excluded)) return;
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromView: state.view,
      active: false,
    };
  });
  elements.main.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active && Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      reset();
      return;
    }
    const target = adjacentTabView(gesture.fromView, deltaX < 0 ? 1 : -1);
    if (!target || Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    gesture.active = true;
    elements.tabList.classList.add('is-dragging');
    positionTabIndicator(
      gesture.fromView,
      target,
      Math.abs(deltaX) / Math.min(window.innerWidth * 0.7, 260),
    );
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  elements.main.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const target = resolveTabSwipe({ view: gesture.fromView, deltaX, deltaY });
    const swiped = gesture.active && target;
    reset();
    if (!swiped) return;
    showView(target);
    elements.swipeHint.hidden = true;
    storage.write(3);
    const suppressClick = (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    };
    document.addEventListener('click', suppressClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', suppressClick, true), 350);
  });
  elements.main.addEventListener('pointercancel', reset);
  window.addEventListener('resize', () => positionTabIndicator(state.view));
  requestAnimationFrame(() => positionTabIndicator(state.view));
}

function setOpenQuery(value) {
  state.openQuery = value;
  for (const input of [elements.openSearch, elements.stickySearch, elements.mobileSearch]) {
    if (input.value !== value) input.value = value;
  }
  renderOpen();
}

function setShippedQuery(value) {
  state.shippedQuery = value;
  for (const input of [
    elements.shippedSearch,
    elements.shippedStickySearch,
    elements.shippedMobileSearch,
  ]) {
    if (input.value !== value) input.value = value;
  }
  renderShipped();
}

function toggleSearch(input, button) {
  const expanded = input.hidden;
  input.hidden = !expanded;
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Close search' : 'Open search');
  if (expanded) input.focus();
}

function openFilterSheet() {
  configureSheetFilters();
  elements.filterSheet.hidden = false;
  document.body.classList.add('sheet-open');
  elements.filterSheetClose.focus();
}

function closeFilterSheet() {
  elements.filterSheet.hidden = true;
  document.body.classList.remove('sheet-open');
  (state.view === 'shipped' ? elements.shippedMobileFilterOpen : elements.mobileFilterOpen).focus();
}

function installStickyObserver(toolbar, sentinel) {
  if (!('IntersectionObserver' in window)) {
    toolbar.classList.add('is-visible');
    return;
  }
  const observer = new IntersectionObserver(([entry]) => {
    toolbar.classList.toggle(
      'is-visible',
      !entry.isIntersecting && entry.boundingClientRect.top < 0,
    );
  }, { threshold: 0 });
  observer.observe(sentinel);
}

function installDiscordDeeplinks() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = event.target.closest('a[data-discord-thread-id]');
    if (!anchor) return;
    const mobile = shouldAttemptDiscordDeeplink({
      viewportWidth: window.innerWidth,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    if (!mobile) return;

    event.preventDefault();
    let attempt = null;
    const removeLifecycleListeners = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', cancelFallback);
    };
    const cancelFallback = () => {
      attempt?.cancel();
      removeLifecycleListeners();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelFallback();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', cancelFallback, { once: true });
    attempt = startDiscordDeeplink({
      appUrl: discordAppThreadUrl(DISCORD_GUILD_ID, anchor.dataset.discordThreadId),
      webUrl: anchor.href,
      timeoutMs: DISCORD_DEEPLINK_TIMEOUT_MS,
      navigate: (url) => {
        if (url === anchor.href) removeLifecycleListeners();
        window.location.assign(url);
      },
    });
  });
}

function syncBackToTop() {
  const visible = window.scrollY > window.innerHeight * 2;
  elements.backToTop.classList.toggle('is-visible', visible);
  elements.backToTop.setAttribute('aria-hidden', String(!visible));
  elements.backToTop.tabIndex = visible ? 0 : -1;
}

function wireControls() {
  installTabSwipe();
  elements.timelineRoot.addEventListener('click', (event) => {
    const anchor = event.target.closest('[data-roadmap-post-id]');
    if (!anchor) return;
    event.preventDefault();
    openTimelinePost(anchor);
  });
  elements.mobileVotingToggle.addEventListener('click', () => {
    const expanded = elements.votingExplanation.classList.toggle('mobile-collapsed') === false;
    elements.mobileVotingToggle.setAttribute('aria-expanded', String(expanded));
    elements.mobileVotingToggle.textContent = expanded ? 'Show less' : 'ⓘ How voting works';
  });
  for (const tab of elements.tabs) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home'
        ? 'open'
        : event.key === 'End'
          ? 'timeline'
          : adjacentTabView(state.view, event.key === 'ArrowRight' ? 1 : -1);
      if (target) showView(target, { focus: true });
    });
  }
  for (const input of [elements.openSearch, elements.stickySearch, elements.mobileSearch]) {
    input.addEventListener('input', (event) => setOpenQuery(event.currentTarget.value));
  }
  for (const input of [
    elements.shippedSearch,
    elements.shippedStickySearch,
    elements.shippedMobileSearch,
  ]) input.addEventListener('input', (event) => setShippedQuery(event.currentTarget.value));
  for (const button of document.querySelectorAll('[data-open-sort]')) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      setOpenSort(button.dataset.openSort);
    });
  }
  for (const button of document.querySelectorAll('[data-shipped-sort]')) {
    button.addEventListener('click', () => setShippedSort(button.dataset.shippedSort));
  }
  elements.stickyClear.addEventListener('click', () => {
    state.openFilters.clear();
    state.controversialOrder = false;
    syncFilterButtons();
    syncSortButtons();
    renderOpen();
  });
  elements.shippedStickyClear.addEventListener('click', () => {
    state.shippedFilters.clear();
    syncFilterButtons();
    renderShipped();
  });
  elements.stickySearchToggle.addEventListener('click', () =>
    toggleSearch(elements.stickySearch, elements.stickySearchToggle));
  elements.shippedStickySearchToggle.addEventListener('click', () =>
    toggleSearch(elements.shippedStickySearch, elements.shippedStickySearchToggle));
  elements.mobileSearchToggle.addEventListener('click', () =>
    toggleSearch(elements.mobileSearch, elements.mobileSearchToggle));
  elements.shippedMobileSearchToggle.addEventListener('click', () =>
    toggleSearch(elements.shippedMobileSearch, elements.shippedMobileSearchToggle));
  elements.mobileFilterOpen.addEventListener('click', openFilterSheet);
  elements.shippedMobileFilterOpen.addEventListener('click', openFilterSheet);
  elements.filterSheetClose.addEventListener('click', closeFilterSheet);
  elements.filterSheetApply.addEventListener('click', closeFilterSheet);
  elements.filterSheet.addEventListener('click', (event) => {
    if (event.target === elements.filterSheet) closeFilterSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.filterSheet.hidden) closeFilterSheet();
  });
  installStickyObserver(elements.stickyToolbar, elements.toolbarSentinel);
  installStickyObserver(elements.shippedStickyToolbar, elements.shippedToolbarSentinel);
  installDiscordDeeplinks();
  elements.backToTop.addEventListener('click', () => window.scrollTo({
    top: 0,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  }));
  window.addEventListener('scroll', syncBackToTop, { passive: true });
  window.addEventListener('resize', () => {
    syncBackToTop();
    for (const note of document.querySelectorAll('.team-note')) measureTeamNote(note);
  });
  syncBackToTop();
}

async function load() {
  wireControls();
  showView(state.view, { updateHash: state.pendingPostId === null });
  try {
    const jsonStarted = performance.now();
    const response = await fetch('./roadmap.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const jsonText = await response.text();
    const jsonDownloaded = performance.now();
    state.data = hydrateRoadmap(JSON.parse(jsonText));
    state.openGlobalRanks = globalPopularityRanks(state.data.open);
    const firstGlobal = state.data.open.find((item) => state.openGlobalRanks.get(item.id) === 1);
    state.openGlobalMaxVotes = Math.max(1, firstGlobal?.votes ?? 0);
    configureHottest();
    configureFilters();
    const jsonParsed = performance.now();
    performance.measure('roadmap-json-download', { start: jsonStarted, end: jsonDownloaded });
    performance.measure('roadmap-json-parse', { start: jsonDownloaded, end: jsonParsed });
    elements.openCount.textContent = state.data.open.length.toLocaleString('en');
    elements.shippedCount.textContent = state.data.shipped.length.toLocaleString('en');
    elements.openSearch.placeholder = `Search ${state.data.open.length.toLocaleString('en')} suggestions…`;
    elements.shippedSearch.placeholder = `Search ${state.data.shipped.length.toLocaleString('en')} shipped features…`;
    elements.freshness.textContent = formatFreshness(state.data.generated_at);
    elements.freshness.dateTime = state.data.generated_at;
    elements.freshness.title = new Date(state.data.generated_at).toLocaleString('en', { dateStyle: 'long', timeStyle: 'short' });
    const renderStarted = performance.now();
    renderContext();
    if (state.pendingPostId) {
      const id = state.pendingPostId;
      const view = state.data.open.some((item) => item.id === id)
        ? 'open'
        : state.data.shipped.some((item) => item.id === id) ? 'shipped' : null;
      state.pendingPostId = null;
      if (view) {
        state.postTarget = { view, id };
        showView(view, { updateHash: false });
        history.replaceState(null, '', `#post-${id}`);
      } else {
        showView(state.view);
      }
    } else if (state.view === 'shipped') renderShipped();
    else if (state.view === 'timeline') renderTimeline();
    else renderOpen();
    performance.measure('roadmap-render-total', { start: renderStarted, end: performance.now() });
    if (state.data.reactions_file) {
      scheduleIdle(() => loadDeferredReactions(state.data.reactions_file).catch((error) => {
        console.error('Reactions unavailable', error);
      }));
    }
  } catch (error) {
    console.error(error);
    const message = el('p', 'error', 'The roadmap could not be loaded. Please try again in a moment.');
    elements.openList.replaceChildren(message);
    elements.openList.setAttribute('aria-busy', 'false');
    elements.shippedList.replaceChildren(message.cloneNode(true));
    elements.shippedList.setAttribute('aria-busy', 'false');
    elements.timelineRoot.replaceChildren(message.cloneNode(true));
    elements.timelineRoot.setAttribute('aria-busy', 'false');
    elements.freshness.textContent = 'temporarily unavailable';
  }
}

load();
