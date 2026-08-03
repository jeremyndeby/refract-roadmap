import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjacentTabView,
  deliveryBadge,
  discordAppThreadUrl,
  globalPopularityRanks,
  groupShipped,
  nextFilterSelection,
  nextTeamNoteExpanded,
  reactionPillDisplay,
  resolveTabSwipe,
  selectOpen,
  selectShipped,
  shouldAttemptDiscordDeeplink,
  startDiscordDeeplink,
} from './roadmap-logic.mjs';

const shipped = [
  { title: 'Recent', requested_by: 2, created_at: '2026-07-20', released_at: '2026-08-01', month: '2026-08', tags: ['Design'] },
  { title: 'Popular', requested_by: 20, created_at: '2026-01-01', released_at: '2026-07-10', month: '2026-07', tags: ['Social'] },
  { title: 'Earlier', requested_by: 7, created_at: null, released_at: null, month: null, tags: ['Design'] },
];

test('Shipped trie, groupe et filtre sur la date de livraison', () => {
  assert.deepEqual(
    groupShipped(shipped, { generatedAt: '2026-08-02T00:00:00Z' }).map((group) => group.key),
    ['2026-08', '2026-07', 'Earlier'],
  );
  assert.deepEqual(
    selectShipped(shipped, { sort: 'popularity', direction: 'desc' }).map((item) => item.title),
    ['Popular', 'Earlier', 'Recent'],
  );
  assert.deepEqual(
    selectShipped(shipped, {
      generatedAt: '2026-08-02T00:00:00Z',
      filters: ['last-7-days'],
    }).map((item) => item.title),
    ['Recent'],
  );
});

test('les dossards Shipped remplacent les anciens libellés de délai', () => {
  assert.deepEqual(
    deliveryBadge({ created_at: '2026-07-20', released_at: '2026-07-31' }),
    { kind: 'express', label: '⚡ Express · 11d', days: 11 },
  );
  assert.deepEqual(
    deliveryBadge({ created_at: '2026-04-01', released_at: '2026-07-10' }),
    { kind: 'worth-wait', label: '🧘 Worth the wait · 100d', days: 100 },
  );
  assert.deepEqual(
    deliveryBadge({ created_at: '2026-06-01', released_at: '2026-07-16' }),
    { kind: 'neutral', label: '45 days', days: 45 },
  );
  assert.equal(deliveryBadge({ created_at: null, released_at: null }), null);
});

test('le deeplink Discord est réservé au mobile ou au tactile', () => {
  assert.equal(shouldAttemptDiscordDeeplink({ viewportWidth: 479 }), true);
  assert.equal(shouldAttemptDiscordDeeplink({ viewportWidth: 1280, coarsePointer: true }), true);
  assert.equal(shouldAttemptDiscordDeeplink({ viewportWidth: 1280, maxTouchPoints: 1 }), true);
  assert.equal(shouldAttemptDiscordDeeplink({ viewportWidth: 1280 }), false);
  assert.equal(
    discordAppThreadUrl('guild', 'thread'),
    'discord://-/channels/guild/thread',
  );
});

test('le rang Popularity reste global dans un sous-ensemble filtré', () => {
  const open = [
    { id: 'one', title: 'One', votes: 30, created_at: '2026-07-01', tags: ['Feature'] },
    { id: 'two', title: 'Two', votes: 20, created_at: '2026-07-02', tags: ['Social'] },
    { id: 'three', title: 'Three', votes: 10, created_at: '2026-07-03', tags: ['Feature'] },
  ];
  const ranks = globalPopularityRanks(open);
  const filtered = selectOpen(open, { filters: ['tag:Feature'] });
  assert.deepEqual(filtered.map((item) => ranks.get(item.id)), [1, 3]);
  assert.deepEqual(
    selectOpen(open, { sort: 'popularity', direction: 'asc' }).map((item) => ranks.get(item.id)),
    [3, 2, 1],
  );
  assert.deepEqual(
    selectOpen(open, { sort: 'date', direction: 'desc' }).map((item) => ranks.get(item.id)),
    [3, 2, 1],
  );
});

test('la note équipe alterne sans fin dans les deux sens', () => {
  let expanded = true;
  const states = [];
  for (let index = 0; index < 8; index++) {
    expanded = nextTeamNoteExpanded(expanded);
    states.push(expanded);
  }
  assert.deepEqual(states, [false, true, false, true, false, true, false, true]);
});

test('les tags sont exclusifs sans désactiver le filtre activité', () => {
  let filters = new Set(['last-7-days', 'tag:Anime']);
  filters = nextFilterSelection(filters, 'tag:Feature', {
    exclusiveValues: new Set(['last-7-days', 'last-30-days']),
    exclusivePrefixes: ['tag:'],
  });
  assert.deepEqual([...filters], ['last-7-days', 'tag:Feature']);
  filters = nextFilterSelection(filters, 'tag:Feature', {
    exclusiveValues: new Set(['last-7-days', 'last-30-days']),
    exclusivePrefixes: ['tag:'],
  });
  assert.deepEqual([...filters], ['last-7-days']);
});

test('la pill officielle porte le max de la famille et les autres réactions restent sémantiques', () => {
  const display = reactionPillDisplay({
    votes: 123,
    reactions: [
      { emoji: '💜', count: 3 },
      { emoji: { name: 'refractlove', id: 'legacy' }, count: 123 },
      { emoji: '👍', count: 16 },
      { emoji: '⬆️', count: 2 },
    ],
  });
  assert.deepEqual(display.visible, [
    { emoji: '💜', count: 123, semantic: 'primary', official: true },
    { emoji: { name: 'refractlove', id: 'legacy' }, count: 123, semantic: 'positive', official: false },
    { emoji: '👍', count: 16, semantic: 'positive', official: false },
  ]);
  assert.equal(display.hiddenCount, 1);
});

test('les réactions débordantes deviennent un compteur neutre après trois pills', () => {
  const display = reactionPillDisplay({
    votes: 97,
    reactions: [
      { emoji: '💜', count: 97 },
      { emoji: '🔥', count: 12 },
      { emoji: '☝️', count: 2 },
      { emoji: '💥', count: 1 },
      { emoji: '🤞', count: 1 },
      { emoji: '🙏', count: 1 },
      { emoji: { name: 'fire', id: 'custom' }, count: 1 },
    ],
  });
  assert.deepEqual(display.visible.map((reaction) => reaction.count), [97, 12, 2]);
  assert.equal(display.hiddenCount, 4);
});

test('une source sans total de famille conserve sa réaction violette brute', () => {
  assert.deepEqual(reactionPillDisplay({
    reactions: [{ emoji: '💜', count: 9 }],
  }), {
    visible: [{ emoji: '💜', count: 9, semantic: 'primary', official: false }],
    hiddenCount: 0,
  });
});

test('Controversial utilise exclusivement le champ downvotes et le trie décroissant', () => {
  const open = [
    { id: 'family-4', title: 'Family four', votes: 1, downvotes: 4, thumbs_down: 0, created_at: '2026-07-01', tags: [] },
    { id: 'family-3', title: 'Family three', votes: 8, downvotes: 3, thumbs_down: 1, created_at: '2026-07-02', tags: [] },
    { id: 'legacy-only', title: 'Legacy only', votes: 99, downvotes: 0, thumbs_down: 12, created_at: '2026-07-03', tags: [] },
  ];
  assert.deepEqual(
    selectOpen(open, {
      filters: ['controversial'],
      controversialOrder: true,
    }).map((item) => item.id),
    ['family-4', 'family-3'],
  );
});

test('le deeplink annule le fallback si l’app prend la main', () => {
  const navigations = [];
  let fallback = null;
  let cleared = false;
  const attempt = startDiscordDeeplink({
    appUrl: 'discord://thread',
    webUrl: 'https://discord.test/thread',
    navigate: (url) => navigations.push(url),
    setTimer: (callback) => { fallback = callback; return 7; },
    clearTimer: (id) => { assert.equal(id, 7); cleared = true; },
  });
  attempt.cancel();
  if (!cleared) fallback();
  assert.equal(cleared, true);
  assert.deepEqual(navigations, ['discord://thread']);
});

test('le deeplink retombe sur le web si l’app est absente', () => {
  const navigations = [];
  let fallback = null;
  startDiscordDeeplink({
    appUrl: 'discord://thread',
    webUrl: 'https://discord.test/thread',
    navigate: (url) => navigations.push(url),
    setTimer: (callback) => { fallback = callback; return 8; },
    clearTimer: () => {},
  });
  fallback();
  assert.deepEqual(navigations, ['discord://thread', 'https://discord.test/thread']);
});

test('le swipe d’onglet exige un geste horizontal dominant dans la bonne direction', () => {
  assert.equal(resolveTabSwipe({ view: 'open', deltaX: -80, deltaY: 12 }), 'shipped');
  assert.equal(resolveTabSwipe({ view: 'shipped', deltaX: -80, deltaY: 12 }), 'timeline');
  assert.equal(resolveTabSwipe({ view: 'shipped', deltaX: 80, deltaY: 12 }), 'open');
  assert.equal(resolveTabSwipe({ view: 'timeline', deltaX: 80, deltaY: 12 }), 'shipped');
  assert.equal(resolveTabSwipe({ view: 'timeline', deltaX: -80, deltaY: 12 }), null);
  assert.equal(resolveTabSwipe({ view: 'open', deltaX: 80, deltaY: 12 }), null);
  assert.equal(resolveTabSwipe({ view: 'open', deltaX: -40, deltaY: 2 }), null);
  assert.equal(resolveTabSwipe({ view: 'open', deltaX: -90, deltaY: 80 }), null);
  assert.equal(adjacentTabView('shipped', 1), 'timeline');
});
