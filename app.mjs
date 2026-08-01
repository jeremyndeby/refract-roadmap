import {
  deliveryBadge,
  groupShipped,
  hasStatus,
  relativeAge,
  roadmapContext,
  selectOpen,
  tagBaseName,
} from './roadmap-logic.mjs';

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
let openRenderVersion = 0;
let descriptionMeasureFrame = null;
const descriptionMeasureQueue = [];

const state = {
  data: null,
  view: location.hash === '#shipped' ? 'shipped' : 'open',
  openQuery: '',
  shippedQuery: '',
  openSort: 'popularity',
  openDirection: 'desc',
  controversialOrder: false,
  openFilters: new Set(),
  tagsExpanded: false,
  shippedSort: 'by-month',
  openRendered: false,
  shippedRendered: false,
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
  openList: document.querySelector('#open-list'),
  shippedList: document.querySelector('#shipped-list'),
  hottestSort: document.querySelector('[data-open-sort="hottest"]'),
  hottestAvailability: document.querySelector('#hottest-availability'),
  activityFilters: document.querySelector('#activity-filters'),
  tagFilters: document.querySelector('#tag-filters'),
  sheetActivityFilters: document.querySelector('#sheet-activity-filters'),
  sheetTagFilters: document.querySelector('#sheet-tag-filters'),
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
  filterSheet: document.querySelector('#filter-sheet'),
  filterSheetClose: document.querySelector('#filter-sheet-close'),
  filterSheetApply: document.querySelector('#filter-sheet-apply'),
  tabs: [...document.querySelectorAll('[role="tab"]')],
  panels: {
    open: document.querySelector('#view-open'),
    shipped: document.querySelector('#view-shipped'),
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
    generated_at: data.generated_at,
    trends_ready: data.trends_ready === true,
    periods: data.periods,
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
        ? item.trend === null ? null : { delta: item.trend[0], percent: item.trend[1] }
        : data.trends_ready ? { delta: 0, percent: 0 } : null,
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
  elements.hottestAvailability.hidden = enabled;
  if (!enabled && state.openSort === 'hottest') {
    state.openSort = 'popularity';
    state.openDirection = 'desc';
  }
  syncSortButtons();
}

function sortLabel(sort) {
  const arrow = state.openDirection === 'asc' ? '↑' : '↓';
  if (sort === 'hottest') return `🔥 Trending ${arrow}`;
  if (sort === 'date') return `Date ${arrow}`;
  return `Popularity ${arrow}`;
}

function syncSortButtons() {
  for (const button of document.querySelectorAll('[data-open-sort]')) {
    const selected = button.dataset.openSort === state.openSort && !state.controversialOrder;
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = sortLabel(button.dataset.openSort);
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

function formatTrend(item) {
  const trend = item.votes_7d;
  if (!trend) {
    return {
      className: 'trend unknown',
      text: '—',
      label: '7-day change not available yet',
    };
  }
  const percent = trend.percent === null
    ? 'new'
    : `${Math.abs(trend.percent).toLocaleString('en', { maximumFractionDigits: 1 })}%`;
  if (trend.delta > 0) {
    return {
      className: 'trend positive',
      text: `↗ +${trend.delta} · ${percent}`,
      label: `Gained ${trend.delta} votes in 7 days, ${percent}`,
    };
  }
  if (trend.delta < 0) {
    return {
      className: 'trend negative',
      text: `↘ ${trend.delta} · ${percent}`,
      label: `Lost ${Math.abs(trend.delta)} votes in 7 days, ${percent}`,
    };
  }
  return {
    className: 'trend zero',
    text: '0 · 0%',
    label: 'No vote change in 7 days',
  };
}

function syncFilterButtons() {
  for (const button of document.querySelectorAll('[data-open-filter]')) {
    button.setAttribute('aria-pressed', String(state.openFilters.has(button.dataset.openFilter)));
  }
  renderActiveFilterSummary();
}

function toggleFilter(filter) {
  if (state.openFilters.has(filter)) {
    state.openFilters.delete(filter);
    if (filter === 'controversial') state.controversialOrder = false;
  } else {
    if (ACTIVITY_FILTERS.has(filter)) {
      for (const active of ACTIVITY_FILTERS) state.openFilters.delete(active);
      state.controversialOrder = filter === 'controversial';
    }
    state.openFilters.add(filter);
  }
  syncFilterButtons();
  syncSortButtons();
  renderOpen();
}

function createFilterChip(label, filter, color, className = '', { activity = false } = {}) {
  const button = el('button', `chip filter-chip ${className}`.trim(), label);
  button.type = 'button';
  button.dataset.openFilter = filter;
  if (activity) button.dataset.filterKind = 'activity';
  button.setAttribute('aria-pressed', String(state.openFilters.has(filter)));
  if (color) setChipColor(button, color);
  button.addEventListener('click', () => toggleFilter(filter));
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
  const fragment = document.createDocumentFragment();
  for (const filter of state.openFilters) {
    const button = el('button', 'sticky-filter', `${filterLabel(filter)} ×`);
    button.type = 'button';
    button.dataset.removeFilter = filter;
    button.addEventListener('click', () => toggleFilter(filter));
    fragment.append(button);
  }
  elements.stickyActiveFilters.replaceChildren(fragment);
  elements.stickyClear.hidden = state.openFilters.size === 0;
  elements.mobileFilterCount.textContent = `· ${state.openFilters.size}`;
}

function reactionColor(emoji) {
  const name = typeof emoji === 'string' ? emoji : emoji.name;
  if (name === '💜' || name.toLocaleLowerCase('en') === 'refractlove') {
    return { accent: '#6C5CE7', text: '#C8C4FF' };
  }
  if (name === '🔥') return '#FDCB6E';
  if (/^(?:👎|⬇|downvote|thumbdown|thumbsdown)/iu.test(name)) {
    return { accent: '#FF6B6B', text: '#FFB3B3' };
  }
  return typeof emoji === 'object' ? '#D6A2E8' : '#81ECEC';
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
  const age = item.created_at ? relativeAge(item.created_at, state.data.generated_at) : '';
  if (item.reactions.length === 0 && (!commentsEnabled || item.comments === 0) && !age) {
    return null;
  }
  const row = el('div', 'reaction-row');
  for (const reaction of item.reactions) {
    const pill = el('span', 'reaction-pill');
    setChipColor(pill, reactionColor(reaction.emoji));
    pill.append(reactionEmoji(reaction.emoji), el('span', '', reaction.count.toLocaleString('en')));
    row.append(pill);
  }
  if (commentsEnabled && item.comments > 0 && item.url) {
    const comments = link(item.url, `💬 ${item.comments.toLocaleString('en')}`);
    comments.className = 'comment-pill';
    comments.setAttribute('aria-label', `${plural(item.comments, 'comment')}; open the Discord thread`);
    comments.dataset.externalHint = '↗';
    row.append(comments);
  }
  if (age) row.append(el('span', 'relative-age', `· ${age}`));
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
  if (rank === 1) return '🥇 1';
  if (rank === 2) return '🥈 2';
  if (rank === 3) return '🥉 3';
  return String(rank);
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

function createOpenRow(item, maxVotes, rank) {
  const popularity = state.openSort === 'popularity' &&
    state.openDirection === 'desc' && !state.controversialOrder;
  const inProgress = hasStatus(item, IN_PROGRESS_STATUS);
  const planned = hasStatus(item, PLANNED_STATUS);
  const classes = ['row'];
  if (popularity && rank === 1) classes.push('rank-first');
  else if (popularity && rank === 2) classes.push('rank-second');
  else if (popularity && rank === 3) classes.push('rank-third');
  else {
    if (popularity && rank <= 10) classes.push('rank-top10');
    if (inProgress) classes.push('in-progress');
    else if (planned) classes.push('planned');
  }
  const article = el('article', classes.join(' '));
  if (popularity) article.dataset.rank = String(rank);

  const voteBlock = el('div', 'votes');
  voteBlock.setAttribute('aria-label', plural(item.votes, 'vote'));
  if (popularity) voteBlock.append(el('span', 'rank', rankMark(rank)));
  const voteNumber = el('div', 'n');
  voteNumber.append(
    el('span', '', item.votes.toLocaleString('en')),
    el('span', 'vote-heart', '💜'),
  );
  voteBlock.append(voteNumber);
  if (state.openFilters.has('controversial')) {
    voteBlock.append(el('span', 'downvote-count', `👎 ${item.downvotes.toLocaleString('en')}`));
  }
  const prism = el('div', 'prism');
  prism.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  fill.style.width = `${Math.max(0, Math.min(100, (item.votes / maxVotes) * 100))}%`;
  prism.append(fill);
  voteBlock.append(prism);
  const trendData = formatTrend(item);
  const trend = el('span', trendData.className, trendData.text);
  trend.setAttribute('aria-label', trendData.label);
  voteBlock.append(trend);

  const body = el('div', 'body');
  const heading = el('h2');
  heading.append(link(item.url, item.title));
  body.append(heading, createDescription(item.excerpt));

  const meta = el('div', 'meta');
  meta.append(el('span', '', `posted ${formatDay(item.created_at)}`), el('span', 'meta-separator', '·'));
  const voteLink = link(item.url, 'Vote on Discord ↗');
  voteLink.className = 'meta-action';
  meta.append(voteLink);
  body.append(meta);

  if (item.note) {
    const note = el('aside', 'note');
    note.append(el('span', 'who', 'From the team'), el('p', '', item.note));
    body.append(note);
  }

  body.append(createReactionSlot(item));

  const chips = el('div', 'chips');
  const orderedTags = [...item.tags].sort((a, b) =>
    Number(Boolean(statusOfTag(b))) - Number(Boolean(statusOfTag(a))) ||
    Number(statusOfTag(b) === 'in-progress') - Number(statusOfTag(a) === 'in-progress'),
  );
  for (const tag of orderedTags) {
    if (tagBaseName(tag) === 'From App') continue;
    const status = statusOfTag(tag);
    const className = status ? `${status}-chip` : '';
    chips.append(createFilterChip(displayStatusTag(tag), `tag:${tag}`, tagColor(tag), className));
  }

  article.append(voteBlock, body, chips);
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
  const maxVotes = Math.max(1, ...state.data.open.map((item) => item.votes));
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
    const initialEnd = Math.min(INITIAL_OPEN_ROWS, items.length);
    for (let index = 0; index < initialEnd; index++) {
      initial.append(createOpenRow(items[index], maxVotes, index + 1));
    }
    elements.openList.replaceChildren(initial);
    elements.openList.setAttribute('aria-busy', String(initialEnd < items.length));

    let cursor = initialEnd;
    const appendBatch = () => {
      if (version !== openRenderVersion) return;
      const fragment = document.createDocumentFragment();
      const end = Math.min(cursor + OPEN_BATCH_SIZE, items.length);
      for (; cursor < end; cursor++) fragment.append(createOpenRow(items[cursor], maxVotes, cursor + 1));
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
  elements.filterSheetApply.textContent = `Show ${plural(items.length, 'suggestion')}`;
  if (!performance.getEntriesByName('roadmap-render-open').length) {
    performance.measure('roadmap-render-open', { start: renderStarted, end: performance.now() });
  }
}

function createShippedRow(item, maxVotes) {
  const article = el('article', `row shipped-card${item.discord_alive ? '' : ' archived-card'}`);
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
  if (item.discord_alive && item.url) heading.append(link(item.url, item.title));
  else heading.append(el('span', '', item.title));
  body.append(heading, createDescription(item.excerpt, { expandable: item.discord_alive }));

  const meta = el('div', 'meta');
  const metaParts = [];
  if (item.created_at) metaParts.push(el('span', '', `posted ${formatDay(item.created_at)}`));
  if (item.released_at) metaParts.push(el('span', '', `shipped ${formatDay(item.released_at)}`));
  if (item.discord_alive && item.url) {
    const discordLink = link(item.url, 'Vote on Discord ↗');
    discordLink.className = 'meta-action shipped-meta-action';
    metaParts.push(discordLink);
  } else {
    metaParts.push(el('span', 'archived-chip meta-archived', '📦 Archived'));
  }
  metaParts.forEach((part, index) => {
    if (index > 0) meta.append(el('span', 'meta-separator', '·'));
    meta.append(part);
  });
  if (meta.childNodes.length > 0) body.append(meta);

  if (item.note) {
    const note = el('aside', 'note');
    note.append(el('span', 'who', 'From the team'), el('p', '', item.note));
    body.append(note);
  }

  body.append(createReactionSlot(item, { commentsEnabled: item.discord_alive }));

  const chips = el('div', 'chips');
  const badge = deliveryBadge(item);
  if (badge) {
    const className = badge.kind === 'neutral'
      ? 'delivery-time neutral'
      : `delivery-badge ${badge.kind}`;
    const badgeNode = el('span', className, badge.label);
    badgeNode.title = `${badge.days} days from suggestion to release`;
    chips.append(badgeNode);
  }
  for (const tag of item.tags) {
    const chip = el('span', 'chip', tag);
    setChipColor(chip, tagColor(tag));
    chips.append(chip);
  }
  article.append(voteBlock, body, chips);
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
  elements.shippedResultCount.textContent = plural(total, 'shipped feature');
  state.shippedRendered = true;
  if (!performance.getEntriesByName('roadmap-render-shipped').length) {
    performance.measure('roadmap-render-shipped', { start: renderStarted, end: performance.now() });
  }
}

function configureFilters() {
  const activityDefinitions = [
    ['🚧 In progress', 'status:In Progress'],
    ['📋 Planned', 'status:Planned'],
    ['⚡ Controversial', 'controversial'],
    ['💜 Needs love', 'needs-love'],
    ['🆕 Last 7 days', 'last-7-days'],
    ['🆕 Last 30 days', 'last-30-days'],
  ];
  for (const container of [elements.activityFilters, elements.sheetActivityFilters]) {
    const activity = document.createDocumentFragment();
    for (const [label, filter] of activityDefinitions) {
      activity.append(createFilterChip(
        label,
        filter,
        { accent: '#B2BEC3', text: '#DFE6E9' },
        'activity-chip',
        { activity: true },
      ));
    }
    container.replaceChildren(activity);
  }

  const publicTags = state.data.tag_names.filter((tag) => !statusOfTag(tag));
  const desktopTags = document.createDocumentFragment();
  publicTags.forEach((tag, index) => {
    const chip = createFilterChip(tag, `tag:${tag}`, tagColor(tag));
    if (!state.tagsExpanded && index >= DESKTOP_TAG_LIMIT) chip.classList.add('tag-overflow');
    desktopTags.append(chip);
  });
  if (publicTags.length > DESKTOP_TAG_LIMIT) {
    const remaining = publicTags.length - DESKTOP_TAG_LIMIT;
    const more = el(
      'button',
      'chip tag-more',
      state.tagsExpanded ? 'Show less' : `+ ${remaining} more`,
    );
    more.type = 'button';
    more.addEventListener('click', () => {
      state.tagsExpanded = !state.tagsExpanded;
      configureFilters();
    });
    desktopTags.append(more);
  }
  elements.tagFilters.replaceChildren(desktopTags);

  const sheetTags = document.createDocumentFragment();
  for (const tag of publicTags) {
    sheetTags.append(createFilterChip(tag, `tag:${tag}`, tagColor(tag)));
  }
  elements.sheetTagFilters.replaceChildren(sheetTags);
  syncFilterButtons();
}

async function loadDeferredReactions(file) {
  const started = performance.now();
  const response = await fetch(`./${file}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Reaction data HTTP ${response.status}`);
  const payload = await response.json();
  const reactions = payload?.reactions ?? {};
  for (const item of state.data.open) item.reactions = reactions[item.id] ?? [];
  for (const item of state.data.shipped) item.reactions = reactions[item.id] ?? [];
  performance.measure('roadmap-reactions-load', { start: started, end: performance.now() });
  patchReactionSlots(elements.openList, state.data.open);
  patchReactionSlots(elements.shippedList, state.data.shipped);
}

function showView(view, { focus = false } = {}) {
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
  history.replaceState(null, '', view === 'shipped' ? '#shipped' : location.pathname + location.search);
}

function setOpenQuery(value) {
  state.openQuery = value;
  for (const input of [elements.openSearch, elements.stickySearch, elements.mobileSearch]) {
    if (input.value !== value) input.value = value;
  }
  renderOpen();
}

function toggleSearch(input, button) {
  const expanded = input.hidden;
  input.hidden = !expanded;
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Close search' : 'Open search');
  if (expanded) input.focus();
}

function openFilterSheet() {
  elements.filterSheet.hidden = false;
  document.body.classList.add('sheet-open');
  elements.filterSheetClose.focus();
}

function closeFilterSheet() {
  elements.filterSheet.hidden = true;
  document.body.classList.remove('sheet-open');
  elements.mobileFilterOpen.focus();
}

function installStickyObserver() {
  if (!('IntersectionObserver' in window)) {
    elements.stickyToolbar.classList.add('is-visible');
    return;
  }
  const observer = new IntersectionObserver(([entry]) => {
    elements.stickyToolbar.classList.toggle(
      'is-visible',
      !entry.isIntersecting && entry.boundingClientRect.top < 0,
    );
  }, { threshold: 0 });
  observer.observe(elements.toolbarSentinel);
}

function wireControls() {
  elements.mobileVotingToggle.addEventListener('click', () => {
    const expanded = elements.votingExplanation.classList.toggle('mobile-collapsed') === false;
    elements.mobileVotingToggle.setAttribute('aria-expanded', String(expanded));
    elements.mobileVotingToggle.textContent = expanded ? 'Show less' : 'ⓘ How voting works';
  });
  for (const tab of elements.tabs) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      showView(state.view === 'open' ? 'shipped' : 'open', { focus: true });
    });
  }
  for (const input of [elements.openSearch, elements.stickySearch, elements.mobileSearch]) {
    input.addEventListener('input', (event) => setOpenQuery(event.currentTarget.value));
  }
  elements.shippedSearch.addEventListener('input', (event) => {
    state.shippedQuery = event.currentTarget.value;
    renderShipped();
  });
  for (const button of document.querySelectorAll('[data-open-sort]')) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      setOpenSort(button.dataset.openSort);
    });
  }
  for (const button of document.querySelectorAll('[data-shipped-sort]')) {
    button.addEventListener('click', () => {
      state.shippedSort = button.dataset.shippedSort;
      for (const peer of document.querySelectorAll('[data-shipped-sort]')) {
        peer.setAttribute('aria-pressed', String(peer === button));
      }
      renderShipped();
    });
  }
  elements.stickyClear.addEventListener('click', () => {
    state.openFilters.clear();
    state.controversialOrder = false;
    syncFilterButtons();
    syncSortButtons();
    renderOpen();
  });
  elements.stickySearchToggle.addEventListener('click', () =>
    toggleSearch(elements.stickySearch, elements.stickySearchToggle));
  elements.mobileSearchToggle.addEventListener('click', () =>
    toggleSearch(elements.mobileSearch, elements.mobileSearchToggle));
  elements.mobileFilterOpen.addEventListener('click', openFilterSheet);
  elements.filterSheetClose.addEventListener('click', closeFilterSheet);
  elements.filterSheetApply.addEventListener('click', closeFilterSheet);
  elements.filterSheet.addEventListener('click', (event) => {
    if (event.target === elements.filterSheet) closeFilterSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.filterSheet.hidden) closeFilterSheet();
  });
  installStickyObserver();
}

async function load() {
  wireControls();
  showView(state.view);
  try {
    const jsonStarted = performance.now();
    const response = await fetch('./roadmap.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const jsonText = await response.text();
    const jsonDownloaded = performance.now();
    state.data = hydrateRoadmap(JSON.parse(jsonText));
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
    if (state.view === 'shipped') renderShipped();
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
    elements.freshness.textContent = 'temporarily unavailable';
  }
}

load();
