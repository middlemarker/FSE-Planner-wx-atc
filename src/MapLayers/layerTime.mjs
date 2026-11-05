export function shortUpdated(value, now = Date.now()) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? iso.slice(11, 16) + 'Z' : iso.slice(5, 10);
}

export function layerProductTime(view, now = Date.now()) {
  if (!view?.manifest && !view?.timeline) return '';
  const frame = (view.timeline?.slices || []).find(item => item.id === view.slice) || null;
  const start = Date.parse(view.manifest?.valid_start || frame?.valid_start || '');
  const end = Date.parse(view.manifest?.valid_end || frame?.valid_end || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end - start >= 6 * 60 * 60 * 1000) return new Date(start).toISOString().slice(5, 10);
  return shortUpdated(Number.isFinite(end) ? end : start, now);
}
