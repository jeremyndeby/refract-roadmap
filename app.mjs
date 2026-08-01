import {
  groupShipped,
  isHot,
  isThisWeek,
  relativeAge,
  roadmapContext,
  selectOpen,
} from './roadmap-logic.mjs';

const state = {
  data: null,
  view: location.hash === '#shipped' ? 'shipped' : 'open',
  openQuery: '',
  shippedQuery: '',
  openSort: 'most-wanted',
  shippedSort: 'by-month',
};

const elements = {
  freshness: document.querySelector('#freshness'),
  shippedThisMonth: document.querySelector('#shipped-this-month'),
  newThisWeek: document.querySelector('#new-this-week'),
  openCount: document.querySelector('#open-count'),
  shippedCount: document.querySelector('#shipped-count'),
  openSearch: document.querySelector('#open-search'),
  shippedSearch: document.querySelector('#shipped-search'),
  openResultCount: document.querySelector('#open-result-count'),
  shippedResultCount: document.querySelector('#shipped-result-count'),
  openList: document.querySelector('#open-list'),
  shippedList: document.querySelector('#shipped-list'),
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
  const { shippedThisMonth, newThisWeek } = roadmapContext(state.data);
  elements.shippedThisMonth.textContent = shippedThisMonth.toLocaleString('en');
  elements.newThisWeek.textContent = newThisWeek.toLocaleString('en');
}

function chipClass(tag) {
  const value = tag.toLocaleLowerCase('en');
  if (value === 'new this week') return 'chip new';
  if (value.includes('progress')) return 'chip progress';
  if (value === '🔥 hot') return 'chip hot';
  return 'chip';
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

function createOpenRow(item, maxVotes) {
  const article = el('article', 'row');

  const voteBlock = el('div', 'votes');
  voteBlock.setAttribute('aria-label', plural(item.votes, 'vote'));
  voteBlock.append(el('div', 'n', item.votes.toLocaleString('en')));
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
  meta.append(
    el('span', '', `posted ${formatDay(item.created_at)} · ${relativeAge(item.created_at)}`),
    el('span', '', plural(item.comments, 'comment')),
  );
  const discordLink = link(item.url, 'Vote on Discord ↗');
  discordLink.className = 'vote';
  meta.append(discordLink);
  body.append(meta);

  if (item.note) {
    const note = el('aside', 'note');
    note.append(el('span', 'who', 'From the team'), el('p', '', item.note));
    body.append(note);
  }

  const chips = el('div', 'chips');
  const labels = [];
  if (isHot(item)) labels.push('🔥 Hot');
  if (isThisWeek(item, state.data.generated_at)) labels.push('New this week');
  for (const tag of item.tags) {
    if (tag !== 'From App' && !labels.includes(tag)) labels.push(tag);
  }
  for (const tag of labels) chips.append(el('span', chipClass(tag), tag));

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
  const items = selectOpen(state.data.open, {
    query: state.openQuery,
    sort: state.openSort,
    generatedAt: state.data.generated_at,
  });
  const fragment = document.createDocumentFragment();
  const maxVotes = Math.max(1, ...state.data.open.map((item) => item.votes));
  for (const item of items) fragment.append(createOpenRow(item, maxVotes));
  if (items.length === 0) {
    const query = state.openQuery.trim();
    const weeklyView = state.openSort === 'this-week';
    fragment.append(createEmptyState({
      title: query ? 'No suggestions found' : weeklyView ? 'Nothing new this week' : 'No open suggestions yet',
      detail: query
        ? `Nothing matched “${query}”. Try another word or clear the search.`
        : weeklyView ? 'No suggestions arrived in the last seven days.' : 'There are no open suggestions to show yet.',
      input: elements.openSearch,
      clear: () => {
        state.openQuery = '';
        renderOpen();
      },
    }));
  }
  elements.openList.replaceChildren(fragment);
  elements.openList.setAttribute('aria-busy', 'false');
  const suffix = state.openSort === 'this-week' ? ' from the last 7 days' : '';
  elements.openResultCount.textContent = `${plural(items.length, 'suggestion')}${suffix}`;
}

function createShippedGroup(group) {
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

  for (const item of group.items) {
    const row = el('div', 'shipped-row');
    const title = el('div', 'title');
    title.append(link(item.url, item.title));
    row.append(title);
    if (Number.isInteger(item.requested_by) && item.requested_by > 0) {
      row.append(el('div', 'requesters', `asked by ${item.requested_by.toLocaleString('en')}`));
    }
    section.append(row);
  }
  return section;
}

function renderShipped() {
  const groups = groupShipped(state.data.shipped, {
    query: state.shippedQuery,
    sort: state.shippedSort,
  });
  const fragment = document.createDocumentFragment();
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  for (const group of groups) fragment.append(createShippedGroup(group));
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
    const response = await fetch('./roadmap.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    elements.openCount.textContent = state.data.open.length.toLocaleString('en');
    elements.shippedCount.textContent = state.data.shipped.length.toLocaleString('en');
    elements.openSearch.placeholder = `Search ${state.data.open.length.toLocaleString('en')} suggestions…`;
    elements.shippedSearch.placeholder = `Search ${state.data.shipped.length.toLocaleString('en')} shipped features…`;
    elements.freshness.textContent = formatFreshness(state.data.generated_at);
    elements.freshness.dateTime = state.data.generated_at;
    elements.freshness.title = new Date(state.data.generated_at).toLocaleString('en', { dateStyle: 'long', timeStyle: 'short' });
    renderContext();
    renderOpen();
    renderShipped();
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
