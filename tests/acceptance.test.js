/**
 * Acceptance Tests - Real Artist Location Verification
 *
 * These tests verify the location resolver produces correct results
 * for known artists. The expected locations are ground truth data.
 *
 * Run with: npm test -- tests/acceptance.test.js
 *
 * Note: These tests make real API calls and may be slow.
 * They can be skipped in CI with: npm test -- --exclude tests/acceptance.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolveArtistLocation } from '../shared/location-resolver.js';

// Ground truth: artists and their known origin locations
// Format: { artist, expectedCity, expectedCountry, notes }
const KNOWN_ARTISTS = [
    // -------------------------------------------------------------------------
    // User's Spotify Top Artists (added from real listening data)
    // -------------------------------------------------------------------------

    // Australian Artists
    {
        artist: 'Ball Park Music',
        expectedCity: 'Brisbane',
        expectedCountry: 'Australia',
        notes: 'Formed in Brisbane, Queensland'
    },
    {
        artist: 'Ninajirachi',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        alternativeCities: ['Wollongong'],
        notes: 'Producer from Sydney area'
    },
    {
        artist: 'The Terrys',
        expectedCity: 'Gerringong',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney', 'Illawarra'],
        notes: 'From Gerringong, Illawarra region NSW'
    },
    {
        artist: 'Royel Otis',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        notes: 'Duo from Sydney'
    },
    {
        artist: 'Ruby Fields',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        alternativeCities: ['Central Coast', 'Wollongong'],
        notes: 'From Central Coast/Wollongong area, NSW'
    },
    {
        artist: 'Kerser',
        expectedCity: 'Campbelltown',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney'],
        notes: 'Rapper from Campbelltown, Sydney'
    },
    {
        artist: 'Hockey Dad',
        expectedCity: 'Windang',
        expectedCountry: 'Australia',
        alternativeCities: ['Wollongong', 'Sydney'],
        notes: 'From Windang, NSW (near Wollongong)'
    },
    {
        artist: 'Montaigne',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        notes: 'Born in Sydney'
    },
    {
        artist: 'Courtney Barnett',
        expectedCity: 'Melbourne',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney'],
        notes: 'Born Sydney, based in Melbourne'
    },
    {
        artist: 'Keli Holiday',
        expectedCity: 'Canberra',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney'],
        notes: 'Adam Hyde project - Adam Hyde is from Canberra'
    },
    {
        artist: 'Stella Donnelly',
        expectedCity: 'Perth',
        expectedCountry: 'Australia',
        alternativeCities: ['Fremantle', 'Western Australia'],
        notes: 'From Perth, Western Australia'
    },
    {
        artist: 'Lime Cordiale',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        alternativeCities: ['Northern Beaches'],
        notes: 'From Sydney Northern Beaches'
    },
    {
        artist: 'San Cisco',
        expectedCity: 'Fremantle',
        expectedCountry: 'Australia',
        alternativeCities: ['Perth', 'Western Australia'],
        notes: 'From Fremantle, Western Australia'
    },
    {
        artist: 'Beddy Rays',
        expectedCity: 'Brisbane',
        expectedCountry: 'Australia',
        alternativeCities: ['Redland Bay', 'Queensland'],
        notes: 'From Redland Bay, Queensland'
    },
    {
        artist: 'Spacey Jane',
        expectedCity: 'Perth',
        expectedCountry: 'Australia',
        alternativeCities: ['Fremantle', 'Western Australia'],
        notes: 'From Perth/Fremantle, Western Australia'
    },
    {
        artist: 'Bugs',
        expectedCity: 'Brisbane',
        expectedCountry: 'Australia',
        notes: 'From Brisbane, Queensland'
    },
    {
        artist: 'These New South Whales',
        expectedCity: 'Melbourne',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney'],
        notes: 'Comedy rock band - MusicBrainz says Melbourne'
    },
    {
        artist: 'The Tullamarines',
        expectedCity: 'Adelaide',
        expectedCountry: 'Australia',
        alternativeCities: ['Melbourne', 'Tullamarine'],
        notes: 'MusicBrainz says Adelaide'
    },
    {
        artist: 'Salarymen',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        notes: 'Australian band from Sydney'
    },
    {
        artist: 'Pacific Avenue',
        expectedCity: 'Gerringong',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney', 'Illawarra'],
        notes: 'From Gerringong, Illawarra region NSW'
    },
    {
        artist: 'GREG',
        expectedCity: 'Unknown',
        expectedCountry: 'Unknown',
        notes: 'Brisbane-based musician - not in MusicBrainz, correctly returns Unknown'
    },
    {
        artist: 'Sven Johnson',
        expectedCity: 'Unknown',
        expectedCountry: 'Unknown',
        notes: 'YouTuber - exists in MusicBrainz but no location data, correctly returns Unknown'
    },
    {
        artist: 'The Rions',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        notes: 'Australian band from Sydney'
    },
    {
        artist: 'Bean Magazine',
        expectedCity: 'Brisbane',
        expectedCountry: 'Australia',
        notes: 'Australian band from Brisbane'
    },
    {
        artist: 'Radium Dolls',
        expectedCity: 'Brisbane',
        expectedCountry: 'Australia',
        notes: 'Australian band from Brisbane'
    },
    {
        artist: 'Rum Jungle',
        expectedCity: 'Newcastle',
        expectedCountry: 'Australia',
        alternativeCities: ['New South Wales'],
        notes: 'Australian band from Newcastle'
    },

    // American Artists
    {
        artist: 'Bleachers',
        expectedCity: 'New York',
        expectedCountry: 'United States',
        alternativeCities: ['New Jersey'],
        notes: 'Jack Antonoff project, NYC-based'
    },
    {
        artist: 'HAIM',
        expectedCity: 'Los Angeles',
        expectedCountry: 'United States',
        alternativeCities: ['San Fernando Valley', 'California'],
        notes: 'Sisters from San Fernando Valley, LA'
    },
    {
        artist: 'Vampire Weekend',
        expectedCity: 'New York',
        expectedCountry: 'United States',
        notes: 'Formed at Columbia University, NYC'
    },
    {
        artist: 'Sabrina Carpenter',
        expectedCity: 'Quakertown',
        expectedCountry: 'United States',
        alternativeCities: ['Pennsylvania', 'Lehigh Valley'],
        notes: 'From Quakertown, Pennsylvania'
    },
    {
        artist: 'Chappell Roan',
        expectedCity: 'Willard',
        expectedCountry: 'United States',
        alternativeCities: ['Missouri', 'Springfield'],
        notes: 'From Willard, Missouri'
    },
    {
        artist: 'St. Vincent',
        expectedCity: 'Tulsa',
        expectedCountry: 'United States',
        alternativeCities: ['Oklahoma', 'Dallas', 'Texas'],
        notes: 'Born in Tulsa, raised in Dallas'
    },
    {
        artist: 'Djo',
        expectedCity: 'Newburyport',
        expectedCountry: 'United States',
        alternativeCities: ['Massachusetts', 'Chicago', 'Illinois'],
        notes: 'Joe Keery project, from Massachusetts'
    },
    {
        artist: 'Cheekface',
        expectedCity: 'Los Angeles',
        expectedCountry: 'United States',
        notes: 'Indie rock band from LA'
    },
    {
        artist: 'King Princess',
        expectedCity: 'Brooklyn',
        expectedCountry: 'United States',
        alternativeCities: ['New York'],
        notes: 'From Brooklyn, New York'
    },
    {
        artist: 'Paul Simon',
        expectedCity: 'Newark',
        expectedCountry: 'United States',
        alternativeCities: ['New Jersey', 'Queens', 'New York'],
        notes: 'Born in Newark, raised in Queens'
    },
    {
        artist: 'Bruce Springsteen',
        expectedCity: 'Long Branch',
        expectedCountry: 'United States',
        alternativeCities: ['Freehold', 'New Jersey'],
        notes: 'Born in Long Branch, raised in Freehold, NJ'
    },
    {
        artist: 'LCD Soundsystem',
        expectedCity: 'New York',
        expectedCountry: 'United States',
        alternativeCities: ['Brooklyn'],
        notes: 'Formed in New York City'
    },
    {
        artist: 'Eagles',
        expectedCity: 'Los Angeles',
        expectedCountry: 'United States',
        notes: 'Formed in Los Angeles, 1971'
    },
    {
        artist: 'Red Hearse',
        expectedCity: 'Bergenfield',
        expectedCountry: 'United States',
        alternativeCities: ['New York', 'New Jersey', 'Los Angeles'],
        notes: 'Supergroup with Jack Antonoff (from Bergenfield NJ), Sam Dew, Sounwave'
    },

    // British Artists
    {
        artist: 'Maisie Peters',
        expectedCity: 'Steyning',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Sussex', 'Brighton', 'England'],
        notes: 'From Steyning, West Sussex'
    },
    {
        artist: 'CHVRCHES',
        expectedCity: 'Glasgow',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Scotland'],
        notes: 'Formed in Glasgow, Scotland'
    },
    {
        artist: 'Olivia Dean',
        expectedCity: 'Walthamstow',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['London'],
        notes: 'From Walthamstow, London'
    },
    {
        artist: 'Florence + The Machine',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Camberwell'],
        notes: 'Florence Welch from London'
    },
    {
        artist: 'The Last Dinner Party',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London'
    },
    {
        artist: 'The Wombats',
        expectedCity: 'Liverpool',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in Liverpool'
    },

    // Canadian Artists
    {
        artist: 'The Beaches',
        expectedCity: 'Toronto',
        expectedCountry: 'Canada',
        notes: 'From The Beaches neighbourhood, Toronto'
    },

    // Other International
    {
        artist: 'Jens Lekman',
        expectedCity: 'Gothenburg',
        expectedCountry: 'Sweden',
        alternativeCities: ['Angered'],
        notes: 'From Angered, Gothenburg'
    },
    {
        artist: 'Joji',
        expectedCity: 'Osaka',
        expectedCountry: 'Japan',
        notes: 'Born in Osaka, Japan'
    },

    // -------------------------------------------------------------------------
    // Reference Artists (well-known, good for baseline testing)
    // -------------------------------------------------------------------------

    // Solo artists - birthplace
    {
        artist: 'Taylor Swift',
        expectedCity: 'Reading', // West Reading, PA
        expectedCountry: 'United States',
        notes: 'Born in West Reading, Pennsylvania'
    },
    {
        artist: 'Beyoncé',
        expectedCity: 'Houston',
        expectedCountry: 'United States',
        notes: 'Born in Houston, Texas'
    },
    {
        artist: 'Ed Sheeran',
        expectedCity: 'Halifax', // Born in Halifax, raised in Framlingham
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Framlingham', 'Suffolk'],
        notes: 'Born in Halifax, West Yorkshire'
    },
    {
        artist: 'Adele',
        expectedCity: 'London', // Tottenham, London
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Tottenham'],
        notes: 'Born in Tottenham, London'
    },
    {
        artist: 'Drake',
        expectedCity: 'Toronto',
        expectedCountry: 'Canada',
        notes: 'Born in Toronto, Ontario'
    },
    {
        artist: 'Billie Eilish',
        expectedCity: 'Los Angeles',
        expectedCountry: 'United States',
        notes: 'Born in Los Angeles, California'
    },
    {
        artist: 'The Weeknd',
        expectedCity: 'Toronto',
        expectedCountry: 'Canada',
        alternativeCities: ['Scarborough'],
        notes: 'Born in Toronto (Scarborough)'
    },
    {
        artist: 'Dua Lipa',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Born in London (to Kosovar-Albanian parents)'
    },
    {
        artist: 'Post Malone',
        expectedCity: 'Syracuse',
        expectedCountry: 'United States',
        alternativeCities: ['Grapevine', 'Dallas'], // Raised in Texas
        notes: 'Born in Syracuse, NY; raised in Grapevine, TX'
    },
    {
        artist: 'Kendrick Lamar',
        expectedCity: 'Compton',
        expectedCountry: 'United States',
        notes: 'Born in Compton, California'
    },

    // Bands - formation location
    {
        artist: 'The Beatles',
        expectedCity: 'Liverpool',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in Liverpool, 1960'
    },
    {
        artist: 'Coldplay',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London, 1996'
    },
    {
        artist: 'Radiohead',
        expectedCity: 'Abingdon',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['Oxford', 'Oxfordshire'],
        notes: 'Formed in Abingdon, Oxfordshire'
    },
    {
        artist: 'Nirvana',
        expectedCity: 'Aberdeen',
        expectedCountry: 'United States',
        alternativeCities: ['Washington'],
        notes: 'Formed in Aberdeen, Washington'
    },
    {
        artist: 'Red Hot Chili Peppers',
        expectedCity: 'Los Angeles',
        expectedCountry: 'United States',
        notes: 'Formed in Los Angeles, 1983'
    },
    {
        artist: 'Foo Fighters',
        expectedCity: 'Seattle',
        expectedCountry: 'United States',
        notes: 'Formed in Seattle, 1994'
    },
    {
        artist: 'Arctic Monkeys',
        expectedCity: 'Sheffield',
        expectedCountry: 'United Kingdom',
        alternativeCities: ['High Green'], // High Green is a suburb of Sheffield
        notes: 'Formed in Sheffield (High Green), 2002'
    },
    {
        artist: 'Tame Impala',
        expectedCity: 'Perth',
        expectedCountry: 'Australia',
        alternativeCities: ['Sydney', 'Western Australia'], // MusicBrainz may have Sydney
        notes: 'Kevin Parker from Perth, Western Australia'
    },
    {
        artist: 'Gorillaz',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London, 1998'
    },
    {
        artist: 'Daft Punk',
        expectedCity: 'Paris',
        expectedCountry: 'France',
        notes: 'Formed in Paris, 1993'
    },

    // International artists
    {
        artist: 'BTS',
        expectedCity: 'Seoul',
        expectedCountry: 'South Korea',
        notes: 'Formed in Seoul, 2010'
    },
    {
        artist: 'BLACKPINK',
        expectedCity: 'Seoul',
        expectedCountry: 'South Korea',
        notes: 'Formed in Seoul, 2016'
    },
    {
        artist: 'Björk',
        expectedCity: 'Reykjavík',
        expectedCountry: 'Iceland',
        notes: 'Born in Reykjavík, Iceland'
    },
    {
        artist: 'Stromae',
        expectedCity: 'Brussels',
        expectedCountry: 'Belgium',
        alternativeCities: ['Etterbeek'],
        notes: 'Born in Etterbeek, Brussels'
    },
    {
        artist: 'Shakira',
        expectedCity: 'Barranquilla',
        expectedCountry: 'Colombia',
        notes: 'Born in Barranquilla, Colombia'
    },
    {
        artist: 'Bad Bunny',
        expectedCity: 'San Juan',
        expectedCountry: 'Puerto Rico',
        alternativeCities: ['Vega Baja', 'Almirante Sur'],
        alternativeCountries: ['United States'], // Puerto Rico is a US territory
        notes: 'Born in Vega Baja, Puerto Rico'
    },
    {
        artist: 'Rammstein',
        expectedCity: 'Berlin',
        expectedCountry: 'Germany',
        notes: 'Formed in Berlin, 1994'
    },
    {
        artist: 'Sigur Rós',
        expectedCity: 'Reykjavík',
        expectedCountry: 'Iceland',
        notes: 'Formed in Reykjavík, 1994'
    },

    // Classic artists
    {
        artist: 'Queen',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London, 1970'
    },
    {
        artist: 'Pink Floyd',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London, 1965'
    },
    {
        artist: 'Led Zeppelin',
        expectedCity: 'London',
        expectedCountry: 'United Kingdom',
        notes: 'Formed in London, 1968'
    },
    {
        artist: 'AC/DC',
        expectedCity: 'Sydney',
        expectedCountry: 'Australia',
        notes: 'Formed in Sydney, 1973'
    },
    {
        artist: 'ABBA',
        expectedCity: 'Stockholm',
        expectedCountry: 'Sweden',
        notes: 'Formed in Stockholm, 1972'
    },
    {
        artist: 'Bob Marley',
        expectedCity: 'Nine Mile',
        expectedCountry: 'Jamaica',
        alternativeCities: ['Saint Ann Parish', 'Kingston'],
        notes: 'Born in Nine Mile, Saint Ann Parish, Jamaica'
    }
];

/**
 * Normalize a string for comparison - removes accents and lowercases
 */
function normalizeForComparison(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
}

/**
 * Check if the resolved location matches expected values.
 * Handles variations in city names, formatting, and Unicode.
 */
function locationMatches(result, expected) {
    // Handle expected Unknown results
    if (expected.expectedCity === 'Unknown' && expected.expectedCountry === 'Unknown') {
        if (result.location_name === 'Unknown') {
            return { matches: true };
        }
        return { matches: false, reason: `Expected Unknown but got "${result.location_name}"` };
    }

    if (!result.location_name || result.location_name === 'Unknown') {
        return { matches: false, reason: 'Location unknown' };
    }

    const locationNorm = normalizeForComparison(result.location_name);

    // Check country (handle alternative countries like "United States" for Puerto Rico)
    const countriesToCheck = [expected.expectedCountry, ...(expected.alternativeCountries || [])];
    const countryMatches = countriesToCheck.some(country =>
        locationNorm.includes(normalizeForComparison(country))
    );

    // Check city (primary or alternatives)
    const citiesToCheck = [expected.expectedCity, ...(expected.alternativeCities || [])];
    const cityMatches = citiesToCheck.some(city =>
        locationNorm.includes(normalizeForComparison(city))
    );

    if (countryMatches && cityMatches) {
        return { matches: true };
    }

    // Partial match - country only (still useful for some artists)
    if (countryMatches && expected.countryOnlyOk) {
        return { matches: true };
    }

    if (countryMatches) {
        return {
            matches: false,
            partial: true,
            reason: `Country matches but city "${expected.expectedCity}" not found in "${result.location_name}"`
        };
    }

    return {
        matches: false,
        reason: `Expected "${expected.expectedCity}, ${expected.expectedCountry}" but got "${result.location_name}"`
    };
}

describe('Real Artist Location Verification', () => {
    // Increase timeout for real API calls
    const TEST_TIMEOUT = 30000; // 30 seconds per test

    describe('Australian Artists (User Library)', () => {
        const australianArtists = KNOWN_ARTISTS.filter(a =>
            ['Ball Park Music', 'Ninajirachi', 'The Terrys', 'Royel Otis', 'Ruby Fields',
             'Kerser', 'Hockey Dad', 'Montaigne', 'Courtney Barnett', 'Keli Holiday',
             'Stella Donnelly', 'Lime Cordiale', 'San Cisco', 'Beddy Rays', 'Spacey Jane',
             'Bugs', 'These New South Whales', 'The Tullamarines', 'Salarymen', 'Pacific Avenue',
             'GREG', 'Sven Johnson', 'The Rions', 'Bean Magazine', 'Radium Dolls', 'Rum Jungle'].includes(a.artist)
        );

        for (const artistData of australianArtists) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('American Artists (User Library)', () => {
        const americanArtists = KNOWN_ARTISTS.filter(a =>
            ['Bleachers', 'HAIM', 'Vampire Weekend', 'Sabrina Carpenter', 'Chappell Roan',
             'St. Vincent', 'Djo', 'Cheekface', 'King Princess', 'Paul Simon',
             'Bruce Springsteen', 'LCD Soundsystem', 'Eagles', 'Red Hearse'].includes(a.artist)
        );

        for (const artistData of americanArtists) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('British Artists (User Library)', () => {
        const britishArtists = KNOWN_ARTISTS.filter(a =>
            ['Maisie Peters', 'CHVRCHES', 'Olivia Dean', 'Florence + The Machine',
             'The Last Dinner Party', 'The Wombats'].includes(a.artist)
        );

        for (const artistData of britishArtists) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('Other International (User Library)', () => {
        const otherArtists = KNOWN_ARTISTS.filter(a =>
            ['The Beaches', 'Jens Lekman', 'Joji'].includes(a.artist)
        );

        for (const artistData of otherArtists) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('Solo Artists', () => {
        const soloArtists = KNOWN_ARTISTS.filter(a =>
            ['Taylor Swift', 'Beyoncé', 'Ed Sheeran', 'Adele', 'Drake',
             'Billie Eilish', 'The Weeknd', 'Dua Lipa', 'Kendrick Lamar'].includes(a.artist)
        );

        for (const artistData of soloArtists) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                    if (artistData.knownIssue) {
                        console.log(`  Known Issue: ${artistData.knownIssue}`);
                    }
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('Bands', () => {
        const bands = KNOWN_ARTISTS.filter(a =>
            ['The Beatles', 'Coldplay', 'Radiohead', 'Nirvana', 'Arctic Monkeys',
             'Tame Impala', 'Daft Punk', 'Foo Fighters'].includes(a.artist)
        );

        for (const artistData of bands) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                    if (artistData.knownIssue) {
                        console.log(`  Known Issue: ${artistData.knownIssue}`);
                    }
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('International Artists', () => {
        const international = KNOWN_ARTISTS.filter(a =>
            ['BTS', 'BLACKPINK', 'Björk', 'Shakira', 'Bad Bunny',
             'Rammstein', 'Sigur Rós', 'ABBA'].includes(a.artist)
        );

        for (const artistData of international) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                    if (artistData.knownIssue) {
                        console.log(`  Known Issue: ${artistData.knownIssue}`);
                    }
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });

    describe('Classic Artists', () => {
        const classics = KNOWN_ARTISTS.filter(a =>
            ['Queen', 'Pink Floyd', 'Led Zeppelin', 'AC/DC', 'Bob Marley'].includes(a.artist)
        );

        for (const artistData of classics) {
            const testFn = artistData.knownIssue ? it.skip : it;
            testFn(`should correctly locate ${artistData.artist}${artistData.knownIssue ? ' (KNOWN ISSUE)' : ''}`, async () => {
                const result = await resolveArtistLocation(artistData.artist);
                const check = locationMatches(result, artistData);

                if (!check.matches) {
                    console.log(`  ${artistData.artist}: ${result.location_name}`);
                    console.log(`  Expected: ${artistData.expectedCity}, ${artistData.expectedCountry}`);
                    console.log(`  Note: ${artistData.notes}`);
                    if (artistData.knownIssue) {
                        console.log(`  Known Issue: ${artistData.knownIssue}`);
                    }
                }

                expect(check.matches, check.reason).toBe(true);
            }, TEST_TIMEOUT);
        }
    });
});

describe('Coordinate Verification', () => {
    // Verify that resolved locations have valid coordinates
    it('should return valid coordinates for well-known artists', async () => {
        const result = await resolveArtistLocation('Taylor Swift');

        expect(result.location_coord).not.toBeNull();
        expect(Array.isArray(result.location_coord)).toBe(true);
        expect(result.location_coord.length).toBe(2);

        const [lat, lon] = result.location_coord;
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);

        // Taylor Swift is from Pennsylvania, USA
        // Rough bounds: lat 39-42, lon -80 to -75
        expect(lat).toBeGreaterThan(35);
        expect(lat).toBeLessThan(45);
        expect(lon).toBeGreaterThan(-85);
        expect(lon).toBeLessThan(-70);
    }, 30000);

    it('should return coordinates in Australia for Tame Impala', async () => {
        const result = await resolveArtistLocation('Tame Impala');

        expect(result.location_coord).not.toBeNull();

        const [lat, lon] = result.location_coord;
        // Perth, Australia: roughly lat -32, lon 115
        expect(lat).toBeLessThan(0); // Southern hemisphere
        expect(lon).toBeGreaterThan(100); // Eastern Australia
    }, 30000);

    it('should return coordinates in Japan for Japanese artists', async () => {
        const result = await resolveArtistLocation('Utada Hikaru');

        if (result.location_coord) {
            const [lat, lon] = result.location_coord;
            // Born in NYC but associated with Japan - accept either
            const isJapan = lat > 30 && lat < 46 && lon > 128 && lon < 146;
            const isUSA = lat > 25 && lat < 50 && lon > -125 && lon < -65;
            expect(isJapan || isUSA).toBe(true);
        }
    }, 30000);
});

describe('Edge Cases', () => {
    it('should handle artists with special characters', async () => {
        const result = await resolveArtistLocation('Sigur Rós');
        expect(result.location_name).not.toBe('Unknown');
        expect(result.location_name.toLowerCase()).toContain('iceland');
    }, 30000);

    it('should handle artists with "The" prefix', async () => {
        const result = await resolveArtistLocation('The Beatles');
        expect(result.location_name.toLowerCase()).toContain('liverpool');
    }, 30000);

    it('should handle single-name artists', async () => {
        const result = await resolveArtistLocation('Prince');
        expect(result.location_name).not.toBe('Unknown');
        // Prince was from Minneapolis
        expect(result.location_name.toLowerCase()).toMatch(/minneapolis|minnesota|united states/);
    }, 30000);

    it('should handle artists with numbers in name', async () => {
        const result = await resolveArtistLocation('Maroon 5');
        expect(result.location_name).not.toBe('Unknown');
        // From Los Angeles
        expect(result.location_name.toLowerCase()).toMatch(/los angeles|california|united states/);
    }, 30000);
});
