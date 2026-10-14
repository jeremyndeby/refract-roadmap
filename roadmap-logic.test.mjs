import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { EARLIER, groupShipped, roadmapContext, releaseDisplay, selectShipped } from './roadmap-logic.mjs';

test('default Shipped order uses hours before popularity and numeric builds for ties', () => {
  const rows = [
    { id: 'early', title: 'Early', tags: [], released_at: '2026-09-18', shipped_at: '2026-09-18T08:00:00.000Z', requested_by: 99 },
    { id: '99', title: 'A', tags: [], released_at: '2026-09-18', shipped_at: '2026-09-18T16:00:00.000Z', shipped_in: 'v1.6.99' },
    { id: '100', title: 'Z', tags: [], released_at: '2026-09-18', shipped_at: '2026-09-18T16:00:00.000Z', shipped_in: 'v1.6.100' },
    { id: 'unknown', title: 'Unknown hour', tags: [], released_at: '2026-09-18', shipped_in: 'v1.6.101' },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(selectShipped(rows).map(x => x.id), ['100', '99', 'early', 'unknown']);
  assert.deepEqual(selectShipped(rows, { sort: 'date' }).map(x => x.id), ['early', '99', 'unknown', '100']);
  assert.equal(selectShipped(rows, { sort: 'popularity' })[0].id, 'early');
  assert.deepEqual(rows, before);
});

test('month groups and Earlier remain ordered when release timestamps belong to older months', () => {
  const rows = [
    { id: 'sep', title: 'September', tags: [], released_at: '2026-09-01', shipped_at: '2026-09-01T12:00:00.000Z' },
    { id: 'oct', title: 'October', tags: [], released_at: '2026-10-01', shipped_at: '2026-08-01T12:00:00.000Z' },
    { id: 'old', title: 'Earlier', tags: [] },
  ];
  assert.deepEqual(groupShipped(rows).map(x => x.key), ['2026-10', '2026-09', EARLIER]);
  assert.deepEqual(groupShipped(rows, { direction: 'asc' }).map(x => x.key), ['2026-09', '2026-10', EARLIER]);
  assert.equal(selectShipped([{ ...rows[0], shipped_at: 'invalid' }])[0].id, 'sep');
});

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


test('displayed day takes precedence over hours and missing hours stay within their day', () => {
  const rows = [
    { id: '14', title: 'A', tags: [], released_at: '2026-09-14', shipped_at: '2026-09-14T20:56:03.380Z', requested_by: 99 },
    { id: '16', title: 'B', tags: [], released_at: '2026-09-16', shipped_at: null },
    { id: '4', title: 'C', tags: [], released_at: '2026-09-04', shipped_at: '2026-09-04T01:00:00.000Z' },
    { id: '3', title: 'D', tags: [], released_at: '2026-09-03', shipped_at: '2026-09-03T12:00:00.000Z' },
    { id: '2', title: 'E', tags: [], released_at: '2026-09-02', shipped_at: '2026-09-02T12:00:00.000Z' },
    { id: '1', title: 'F', tags: [], released_at: '2026-09-01', shipped_at: '2026-09-01T12:00:00.000Z' },
    { id: 'earlier', title: 'G', tags: [] },
  ];
  assert.deepEqual(selectShipped(rows).map(x => x.id), ['16', '14', '4', '3', '2', '1', 'earlier']);
});


test('real 262-item metadata snapshot has no displayed-day inversions and every hour matches Paris', () => {
  // Real date/time/version/heart values; titles and original IDs removed.
  const rows = JSON.parse(readFileSync(new URL('./test-fixtures/shipped-time-real.json', import.meta.url)));
  assert.equal(rows.length, 262);
  const sorted = selectShipped(rows);
  let previous = '9999-12-31';
  const paris = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const row of sorted) {
    const day = row.released_at ?? '';
    assert(previous >= day, `${previous} before ${day}`);
    previous = day;
    if (row.shipped_at) assert.equal(paris.format(new Date(row.shipped_at)), day, row.id);
  }
  assert.deepEqual(groupShipped(rows).map(group => [group.key, group.items.length]), [
    ['2026-10', 7], ['2026-09', 50], ['2026-08', 89], ['2026-07', 17],
    ['2026-06', 17], ['2026-05', 11], ['2026-04', 20], [EARLIER, 51],
  ]);
});
