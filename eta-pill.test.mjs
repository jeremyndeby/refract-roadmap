import assert from 'node:assert/strict';
import test from 'node:test';

import { statusPillMarkup, timelineStatusForPost } from './eta-pill.mjs';

const BEFORE_ETA_IN_PROGRESS_HTML = '<span class="edge-badge status-badge status-badge-progress">🚧 In Progress</span>';
const BEFORE_ETA_PLANNED_HTML = '<span class="edge-badge status-badge status-badge-planned">📋 Planned</span>';

test('sans ETA, le HTML du statut reste identique caractère pour caractère', () => {
  assert.equal(
    statusPillMarkup({ collection: 'open', status: 'In Progress' }),
    BEFORE_ETA_IN_PROGRESS_HTML,
  );
  assert.equal(
    statusPillMarkup({ collection: 'open', status: 'Planned' }),
    BEFORE_ETA_PLANNED_HTML,
  );
});

test('une clé ETA inconnue ne rend aucune moitié ETA et la carte reste rendable', () => {
  for (const eta of ['unknown_eta_key', 'toString', '__proto__']) {
    const html = statusPillMarkup({ collection: 'open', status: 'In Progress', eta });
    assert.equal(html, BEFORE_ETA_IN_PROGRESS_HTML);
    assert.equal(html.includes('eta-badge'), false);
  }
});

test('une carte Shipped portant eta ne rend aucune pill de statut ou ETA', () => {
  assert.equal(statusPillMarkup({
    collection: 'shipped',
    status: 'In Progress',
    eta: 'few_updates',
  }), '');
});

test('les sept clés ETA rendent uniquement leur libellé public stable', () => {
  const cases = [
    ['next_update', 'Next update'],
    ['few_updates', 'In a few updates'],
    ['late_2026', 'Late 2026'],
    ['early_2027', 'Early 2027'],
    ['mid_2027', 'Mid 2027'],
    ['late_2027', 'Late 2027'],
    ['exploring', 'Exploring'],
  ];

  for (const [eta, label] of cases) {
    const html = statusPillMarkup({ collection: 'open', status: 'Planned', eta });
    assert.match(html, new RegExp(`<span class="eta-badge">${label}</span>`));
    assert.equal(html.includes(eta), false);
  }
});

test('un statut Timeline explicite complète une carte ETA dont le tag de statut manque', () => {
  const timeline = {
    years: [{
      nodes: [{
        items: [{
          post: { id: 'custom-posters', view: 'open' },
          status: { kind: 'progress', label: '🚧 in progress' },
        }],
      }],
    }],
  };

  assert.equal(timelineStatusForPost(timeline, 'custom-posters'), 'In Progress');
  assert.equal(timelineStatusForPost(timeline, 'missing'), null);
});
