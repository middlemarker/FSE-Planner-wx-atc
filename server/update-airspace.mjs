import { mkdir, writeFile } from 'node:fs/promises';
import { loadAirspace } from './providers.mjs';
const value = await loadAirspace();
await mkdir(new URL('./cache/', import.meta.url), { recursive: true });
await writeFile(new URL('./cache/airspace.json', import.meta.url), JSON.stringify(value));
console.log(`Saved ${value.features.length} boundaries at ${value.version}`);
