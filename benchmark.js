import { resolveArtistLocation } from './shared/location-resolver.js';

const artists = [
    'Taylor Swift',
    'The Beatles',
    'Daft Punk',
    'Adele',
    'BTS'
];

console.log(`Testing ${artists.length} artists sequentially...\n`);
const start = Date.now();

for (const name of artists) {
    const result = await resolveArtistLocation(name);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${elapsed}s] ${name}: ${result.location_name}`);
}

const total = (Date.now() - start) / 1000;
console.log(`\nTotal: ${total.toFixed(1)}s for ${artists.length} artists`);
console.log(`Average: ${(total / artists.length).toFixed(1)}s per artist`);
