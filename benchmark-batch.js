import { resolveArtistLocation } from './shared/location-resolver.js';

const artists = [
    'Taylor Swift',
    'The Beatles',
    'Daft Punk',
    'Adele',
    'BTS',
    'Coldplay'
];

const BATCH_SIZE = 3;

console.log(`Testing ${artists.length} artists in batches of ${BATCH_SIZE}...\n`);
const start = Date.now();

for (let i = 0; i < artists.length; i += BATCH_SIZE) {
    const batch = artists.slice(i, i + BATCH_SIZE);
    const batchStart = Date.now();

    const results = await Promise.all(
        batch.map(async (name) => {
            const result = await resolveArtistLocation(name);
            return { name, location: result.location_name };
        })
    );

    const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
    const totalTime = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Batch ${Math.floor(i/BATCH_SIZE) + 1} (${batchTime}s):`);
    results.forEach(r => console.log(`  ${r.name}: ${r.location}`));
    console.log(`  [Total elapsed: ${totalTime}s]\n`);
}

const total = (Date.now() - start) / 1000;
console.log(`Total: ${total.toFixed(1)}s for ${artists.length} artists`);
console.log(`Average: ${(total / artists.length).toFixed(1)}s per artist`);
console.log(`\nSequential would be: ~${(artists.length * 2.8).toFixed(0)}s`);
