import assert from 'node:assert/strict';
import test from 'node:test';

import { EARLIER, groupShipped, roadmapContext, releaseDisplay } from './roadmap-logic.mjs';

test('monthly grouping ignores stale display, version and month fields without released_at', () => {
  const items = [
    { id: 'a', title: 'A', shipped_in: 'V1.6.720', shipped_in_display: 'V1.6' },
    { id: 'b', title: 'B', shipped_in: 'v1.6.741', released_at: '2026-10-07', month: '2026-09' },
    { id: 'c', title: 'C', month: '2026-08' },
  ];
  const before = structuredClone(items);
  const groups = groupShipped(items);
  assert.deepEqual(groups.map(group => group.key), ['2026-10', EARLIER]);
  assert.equal(groups[0].label, 'October 2026');
  assert.deepEqual(groups[1].items.map(item => item.id), ['a', 'c']);
  assert.deepEqual(items, before);
});

test('badge keeps full build despite obsolete cycle-only display from cached JSON', () => {
  assert.equal(releaseDisplay({ shipped_in: 'V1.6.741', shipped_in_display: 'V1.6' }, 'shipped_in'), 'v1.6.741');
  assert.equal(releaseDisplay({ shipped_in: 'V1.6', build: 'v1.6.741' }, 'shipped_in'), 'v1.6.741');
  assert.equal(releaseDisplay({ shipped_in: 'v1.6.741' }, 'shipped_in'), 'v1.6.741');
  assert.equal(releaseDisplay({ cycle: 'V1.6', cycle_display: 'V1.6' }, 'cycle'), 'V1.6');
});

const base = {
  title: 'Feature',
  excerpt: 'Description',
  tags: [],
  requested_by: 1,
  created_at: '2026-01-01',
};

test('Shipped in classe uniquement par released_at et garde Earlier en dernier', () => {
  const items = [
    { ...base, id: '1', shipped_in: 'V1.6' },
    { ...base, id: '2' },
    { ...base, id: '3', shipped_in: '2026-08' },
    { ...base, id: '4', released_at: '2026-07-14', month: '2026-07' },
    {
      ...base,
      id: '5',
      shipped_in: 'V1.6',
      released_at: '2026-08-18',
      month: '2026-08',
      build: 'v1.6.714',
    },
  ];
  const groups = groupShipped(items, { generatedAt: '2026-08-19T12:00:00Z' });
  assert.equal(groups.at(-1).key, EARLIER);
  assert.deepEqual(Object.fromEntries(groups.map((group) => [group.key, {
    label: group.label,
    ids: group.items.map((item) => item.id),
  }])), {
    '2026-07': { label: 'July 2026', ids: ['4'] },
    '2026-08': { label: 'August 2026', ids: ['5'] },
    [EARLIER]: { label: EARLIER, ids: ['1', '2', '3'] },
  });
  assert.deepEqual(groupShipped(items), groupShipped(items));
});

test('les surfaces récentes ignorent toute carte sans date éditoriale exacte', () => {
  const shipped = [
    { ...base, id: '1', released_at: '2026-08-18' },
    { ...base, id: '2', shipped_in: '2026-08' },
    { ...base, id: '3' },
  ];
  const context = roadmapContext({
    open: [],
    shipped,
    generated_at: '2026-08-19T12:00:00Z',
  });
  assert.equal(context.shippedLast30Days, 1);
});

test('une valeur Shipped in invalide est ignorée défensivement', () => {
  const groups = groupShipped([
    { ...base, id: '1', shipped_in: 'soon' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, EARLIER);
});

test('date sorting remains chronological in both directions, Earlier always last', () => {
  const items = [
    { ...base, id: '1', released_at: '2026-09-09' },
    { ...base, id: '2', released_at: '2026-10-07', shipped_in: 'v1.6.741' },
    { ...base, id: '3' },
  ];
  assert.deepEqual(groupShipped(items).map(group => group.key), ['2026-10', '2026-09', EARLIER]);
  assert.deepEqual(groupShipped(items, { direction: 'asc' }).map(group => group.key), ['2026-09', '2026-10', EARLIER]);
});

test('Popularity remains one group with the existing requester ordering', () => {
  const items = [
    { ...base, id: '1', requested_by: 9 },
    { ...base, id: '2', requested_by: 2, released_at: '2026-10-07' },
    { ...base, id: '3', requested_by: 4, released_at: '2026-09-09' },
  ];
  const groups = groupShipped(items, { sort: 'popularity' });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'popularity');
  assert.equal(groups[0].ungrouped, true);
  assert.deepEqual(groups[0].items.map(item => item.id), ['1', '3', '2']);
});
