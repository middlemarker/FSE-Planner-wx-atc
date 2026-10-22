let current = { vatsim: null, weather: null, airspace: null };
export function setLiveSnapshot(snapshot) { current = snapshot || current; }
export function getLiveSnapshot() { return current; }
