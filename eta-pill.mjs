export const ETA_LABELS = Object.freeze({
  next_update: 'Next update',
  few_updates: 'In a few updates',
  late_2026: 'Late 2026',
  early_2027: 'Early 2027',
  mid_2027: 'Mid 2027',
  late_2027: 'Late 2027',
  exploring: 'Exploring',
});

export function etaLabel(eta) {
  return Object.hasOwn(ETA_LABELS, eta) ? ETA_LABELS[eta] : null;
}

const STATUS_PILLS = Object.freeze({
  'In Progress': Object.freeze({
    kind: 'progress',
    label: '🚧 In Progress',
  }),
  Planned: Object.freeze({
    kind: 'planned',
    label: '📋 Planned',
  }),
});

export function statusPillMarkup({ collection = 'open', status, eta }) {
  if (collection !== 'open') return '';

  const pill = STATUS_PILLS[status];
  if (!pill) return '';

  const className = `edge-badge status-badge status-badge-${pill.kind}`;
  const publicEtaLabel = etaLabel(eta);
  if (!publicEtaLabel) return `<span class="${className}">${pill.label}</span>`;

  return `<span class="${className} status-badge-with-eta"><span class="status-badge-label">${pill.label}</span><span class="eta-badge">${publicEtaLabel}</span></span>`;
}
