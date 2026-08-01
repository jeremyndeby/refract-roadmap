import {
  deliveryBadge,
  groupShipped,
  isHot,
  isLast30Days,
  isLast7Days,
  relativeAge,
  roadmapContext,
  selectOpen,
} from './roadmap-logic.mjs';

const DISCORD_GUILD_ID = '1490347491151970366';
const INITIAL_OPEN_ROWS = 25;
const OPEN_BATCH_SIZE = 50;
const IN_PROGRESS_TAG = 'In Progress';
let openRenderVersion = 0;

const state = {
  data: null,
  view: location.hash === '#shipped' ? 'shipped' : 'open',
  openQuery: '',
  shippedQuery: '',
  openSort: 'popularity',
  openFilters: new Set(),
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
  openResultCount: document.querySelector('#open-result-count'),
  shippedResultCount: document.querySelector('#shipped-result-count'),
  openList: document.querySelector('#open-list'),
  shippedList: document.querySelector('#shipped-list'),
  hottestSort: document.querySelector('[data-open-sort="hottest"]'),
  hottestAvailability: document.querySelector('#hottest-availability'),
  activityFilters: document.querySelector('#activity-filters'),
  tagFilters: document.querySelector('#tag-filters'),
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
  elements.hottestSort.disabled = !enabled;
  elements.hottestSort.setAttribute('aria-disabled', String(!enabled));
  elements.hottestAvailability.hidden = enabled;
  if (!enabled && state.openSort === 'hottest') state.openSort = 'popularity';
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
  Planned: '#B2BEC3',
  Profile: '#55EFC4',
  Settings: '#D6A2E8',
  Social: '#00CEC9',
  Stats: '#FAB1A0',
  'TV Shows': { accent: '#E17055', text: '#FFC2AE' },
});

function tagColor(tag) {
  return TAG_COLORS[tag] ?? '#B2BEC3';
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
}

function toggleFilter(filter) {
  if (state.openFilters.has(filter)) state.openFilters.delete(filter);
  else state.openFilters.add(filter);
  syncFilterButtons();
  renderOpen();
}

function createFilterChip(label, filter, color, className = '') {
  const button = el('button', `chip filter-chip ${className}`.trim(), label);
  button.type = 'button';
  button.dataset.openFilter = filter;
  button.setAttribute('aria-pressed', String(state.openFilters.has(filter)));
  if (color) setChipColor(button, color);
  button.addEventListener('click', () => toggleFilter(filter));
  return button;
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

function rankMark(rank) {
  if (rank === 1) return '🥇 1';
  if (rank === 2) return '🥈 2';
  if (rank === 3) return '🥉 3';
  return String(rank);
}

function createOpenRow(item, maxVotes, rank) {
  const popularity = state.openSort === 'popularity';
  const inProgress = item.tags.includes(IN_PROGRESS_TAG);
  const classes = ['row'];
  if (popularity && rank === 1) classes.push('rank-first');
  else if (popularity && rank <= 3) classes.push('rank-top3');
  else {
    if (popularity && rank <= 10) classes.push('rank-top10');
    if (inProgress) classes.push('in-progress');
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
  body.append(heading, el('p', '', item.excerpt));

  const meta = el('div', 'meta');
  meta.append(el('span', '', `posted ${formatDay(item.created_at)}`));
  body.append(meta);

  if (item.note) {
    const note = el('aside', 'note');
    note.append(el('span', 'who', 'From the team'), el('p', '', item.note));
    body.append(note);
  }

  const reactionRow = createReactionRow(item);
  if (reactionRow) body.append(reactionRow);

  const chips = el('div', 'chips');
  const discordLink = link(item.url, 'Vote on Discord ↗');
  discordLink.className = 'chip card-action';
  chips.append(discordLink);
  if (isHot(item)) chips.append(el('span', 'chip hot', '🔥 Hot'));
  if (isLast7Days(item, state.data.generated_at)) {
    chips.append(createFilterChip('Last 7 days', 'last-7-days', '#55EFC4', 'new'));
  } else if (isLast30Days(item, state.data.generated_at)) {
    chips.append(createFilterChip('Last 30 days', 'last-30-days', '#55EFC4', 'new'));
  }
  const orderedTags = [...item.tags].sort((a, b) =>
    Number(b === IN_PROGRESS_TAG) - Number(a === IN_PROGRESS_TAG),
  );
  for (const tag of orderedTags) {
    if (tag === 'From App') continue;
    const label = tag === IN_PROGRESS_TAG ? '🚧 In Progress' : tag;
    const className = tag === IN_PROGRESS_TAG ? 'in-progress-chip' : '';
    chips.append(createFilterChip(label, `tag:${tag}`, tagColor(tag), className));
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
  body.append(heading, el('p', '', item.excerpt));

  const meta = el('div', 'meta');
  if (item.created_at) meta.append(el('span', '', `posted ${formatDay(item.created_at)}`));
  if (item.released_at) meta.append(el('span', '', `shipped ${formatDay(item.released_at)}`));
  if (meta.childNodes.length > 0) body.append(meta);

  if (item.note) {
    const note = el('aside', 'note');
    note.append(el('span', 'who', 'From the team'), el('p', '', item.note));
    body.append(note);
  }

  const reactionRow = createReactionRow(item, { commentsEnabled: item.discord_alive });
  if (reactionRow) body.append(reactionRow);

  const chips = el('div', 'chips');
  if (item.discord_alive && item.url) {
    const discordLink = link(item.url, 'Vote on Discord ↗');
    discordLink.className = 'chip card-action shipped-action';
    chips.append(discordLink);
  } else {
    chips.append(el('span', 'chip archived-chip', '📦 Archived'));
  }
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
  const activity = document.createDocumentFragment();
  activity.append(
    createFilterChip(
      '⚡ Controversial',
      'controversial',
      { accent: '#FF6B6B', text: '#FFB3B3' },
    ),
    createFilterChip(
      '💜 Needs love',
      'needs-love',
      { accent: '#6C5CE7', text: '#C8C4FF' },
    ),
    createFilterChip('🆕 Last 7 days', 'last-7-days', '#55EFC4', 'new'),
    createFilterChip('🆕 Last 30 days', 'last-30-days', '#55EFC4', 'new'),
    createFilterChip('🚧 In progress', 'tag:In Progress', '#FDCB6E', 'in-progress-chip'),
  );
  elements.activityFilters.replaceChildren(activity);

  const tags = document.createDocumentFragment();
  for (const tag of state.data.tag_names) {
    if (tag === IN_PROGRESS_TAG) continue;
    tags.append(createFilterChip(tag, `tag:${tag}`, tagColor(tag)));
  }
  elements.tagFilters.replaceChildren(tags);
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
  if (state.view === 'open') renderOpen();
  else renderShipped();
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

function wireControls() {
  for (const tab of elements.tabs) {
    tab.addEventListener('click', () => showView(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      showView(state.view === 'open' ? 'shipped' : 'open', { focus: true });
    });
  }
  elements.openSearch.addEventListener('input', (event) => {
    state.openQuery = event.currentTarget.value;
    renderOpen();
  });
  elements.shippedSearch.addEventListener('input', (event) => {
    state.shippedQuery = event.currentTarget.value;
    renderShipped();
  });
  for (const button of document.querySelectorAll('[data-open-sort]')) {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      state.openSort = button.dataset.openSort;
      for (const peer of document.querySelectorAll('[data-open-sort]')) {
        peer.setAttribute('aria-pressed', String(peer === button));
      }
      renderOpen();
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
