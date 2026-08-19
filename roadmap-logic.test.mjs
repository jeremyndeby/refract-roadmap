import assert from 'node:assert/strict';
import test from 'node:test';

import { EARLIER, groupShipped, roadmapContext } from './roadmap-logic.mjs';

const base = {
  title: 'Feature',
  excerpt: 'Description',
  tags: [],
  requested_by: 1,
  created_at: '2026-01-01',
};

test('Shipped in classe par version ou mois et garde Earlier en dernier', () => {
  const items = [
    { ...base, id: '1', shipped_in: 'V1.6' },
    { ...base, id: '2' },
    { ...base, id: '3', shipped_in: '2026-08' },
    { ...base, id: '4', released_at: '2026-07-14', month: '2026-07' },
  ];
  const groups = groupShipped(items, { generatedAt: '2026-08-19T12:00:00Z' });
  assert.equal(groups.at(-1).key, EARLIER);
  assert.deepEqual(Object.fromEntries(groups.map((group) => [group.key, {
    label: group.label,
    ids: group.items.map((item) => item.id),
  }])), {
    '2026-07': { label: 'July 2026', ids: ['4'] },
    '2026-08': { label: 'August 2026', ids: ['3'] },
    'V1.6': { label: 'V1.6', ids: ['1'] },
    [EARLIER]: { label: EARLIER, ids: ['2'] },
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
