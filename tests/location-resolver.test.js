/**
 * Tests for the shared location-resolver module
 *
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    // Constants
    USER_AGENT,
    IS_PERSON_TYPE_ID,

    // Area helpers
    areaSpecificity,
    chooseBestArea,
    isCityLevel,
    isCityLevelGeocode,

    // Name matching helpers
    isExactMatch,
    verifyArtistMatch,

    // Country code helpers
    extractCountryCode,
    countryCodeToName,

    // Display name helpers
    normalizeDisplayName,
    cleanWikipediaLocation,

    // Fetch functions
    fetchWithRetry,
    fetchFromMusicBrainz,
    resolveAreaCountry,
    fetchLocationViaRelationships,
    fetchFromWikipedia,
    fetchFromWikidata,
    fetchSubdivisionCapital,

    // Geocoding
    geocodeLocation,
    geocodeWithNominatim,
    geocodeWithPhoton,
    geocodeMusicBrainzResult,

    // Main orchestrator
    resolveArtistLocation
} from '../shared/location-resolver.js';

// ---------------------------------------------------------------------------
// Constants Tests
// ---------------------------------------------------------------------------

describe('Constants', () => {
    it('should have a valid USER_AGENT string', () => {
        expect(USER_AGENT).toContain('WhereAmIListening');
        expect(USER_AGENT).toContain('github.com');
    });

    it('should have a valid IS_PERSON_TYPE_ID', () => {
        expect(IS_PERSON_TYPE_ID).toBe('dd9886f2-1dfe-4270-97db-283f6839a666');
    });
});

// ---------------------------------------------------------------------------
// Area Specificity Helper Tests
// ---------------------------------------------------------------------------

describe('areaSpecificity', () => {
    it('should return -1 for null/undefined', () => {
        expect(areaSpecificity(null)).toBe(-1);
        expect(areaSpecificity(undefined)).toBe(-1);
    });

    it('should return 0 for country', () => {
        expect(areaSpecificity('country')).toBe(0);
        expect(areaSpecificity('Country')).toBe(0);
    });

    it('should return 1 for subdivision', () => {
        expect(areaSpecificity('subdivision')).toBe(1);
        expect(areaSpecificity('Subdivision')).toBe(1);
    });

    it('should return 2 for county', () => {
        expect(areaSpecificity('county')).toBe(2);
    });

    it('should return 3 for city-level types', () => {
        expect(areaSpecificity('city')).toBe(3);
        expect(areaSpecificity('City')).toBe(3);
        expect(areaSpecificity('municipality')).toBe(3);
        expect(areaSpecificity('district')).toBe(3);
        expect(areaSpecificity('town')).toBe(3);
        expect(areaSpecificity('village')).toBe(3);
        expect(areaSpecificity('island')).toBe(3);
    });

    it('should return 1 for unknown types', () => {
        expect(areaSpecificity('unknown')).toBe(1);
        expect(areaSpecificity('something_else')).toBe(1);
    });
});

describe('chooseBestArea', () => {
    it('should return null when no areas exist', () => {
        expect(chooseBestArea({})).toBeNull();
        expect(chooseBestArea({ beginArea: null, area: null })).toBeNull();
    });

    it('should return beginArea when only beginArea exists', () => {
        const result = chooseBestArea({
            beginArea: 'Sydney',
            beginAreaId: '123',
            beginAreaType: 'City',
            area: null
        });
        expect(result).toEqual({ name: 'Sydney', id: '123', type: 'City' });
    });

    it('should return area when only area exists', () => {
        const result = chooseBestArea({
            beginArea: null,
            area: 'Australia',
            areaId: '456',
            areaType: 'Country'
        });
        expect(result).toEqual({ name: 'Australia', id: '456', type: 'Country' });
    });

    it('should prefer area when equally specific', () => {
        const result = chooseBestArea({
            beginArea: 'Sydney',
            beginAreaId: '123',
            beginAreaType: 'City',
            area: 'Melbourne',
            areaId: '456',
            areaType: 'City'
        });
        expect(result).toEqual({ name: 'Melbourne', id: '456', type: 'City' });
    });

    it('should prefer more specific area', () => {
        const result = chooseBestArea({
            beginArea: 'Sydney',
            beginAreaId: '123',
            beginAreaType: 'City',
            area: 'Australia',
            areaId: '456',
            areaType: 'Country'
        });
        expect(result).toEqual({ name: 'Sydney', id: '123', type: 'City' });
    });

    it('should prefer area when area is more specific', () => {
        const result = chooseBestArea({
            beginArea: 'Australia',
            beginAreaId: '123',
            beginAreaType: 'Country',
            area: 'Sydney',
            areaId: '456',
            areaType: 'City'
        });
        expect(result).toEqual({ name: 'Sydney', id: '456', type: 'City' });
    });
});

describe('isCityLevel', () => {
    it('should return true for city-level types', () => {
        expect(isCityLevel('city')).toBe(true);
        expect(isCityLevel('City')).toBe(true);
        expect(isCityLevel('town')).toBe(true);
        expect(isCityLevel('village')).toBe(true);
        expect(isCityLevel('municipality')).toBe(true);
        expect(isCityLevel('district')).toBe(true);
        expect(isCityLevel('island')).toBe(true);
    });

    it('should return false for non-city-level types', () => {
        expect(isCityLevel('country')).toBe(false);
        expect(isCityLevel('subdivision')).toBe(false);
        expect(isCityLevel('county')).toBe(false);
        expect(isCityLevel(null)).toBe(false);
    });
});

describe('isCityLevelGeocode', () => {
    it('should return true for city-level address types', () => {
        expect(isCityLevelGeocode({ addressType: 'city' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'City' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'town' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'village' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'municipality' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'suburb' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'neighbourhood' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'district' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'borough' })).toBe(true);
        expect(isCityLevelGeocode({ addressType: 'locality' })).toBe(true);
    });

    it('should return false for non-city-level results', () => {
        expect(isCityLevelGeocode({ addressType: 'state' })).toBe(false);
        expect(isCityLevelGeocode({ addressType: 'country' })).toBe(false);
        expect(isCityLevelGeocode({ addressType: 'county' })).toBe(false);
        expect(isCityLevelGeocode(null)).toBe(false);
        expect(isCityLevelGeocode({})).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Name Matching Helper Tests
// ---------------------------------------------------------------------------

describe('isExactMatch', () => {
    it('should return true for exact matches (case insensitive)', () => {
        expect(isExactMatch('Taylor Swift', 'Taylor Swift')).toBe(true);
        expect(isExactMatch('taylor swift', 'Taylor Swift')).toBe(true);
        expect(isExactMatch('TAYLOR SWIFT', 'taylor swift')).toBe(true);
    });

    it('should handle whitespace trimming', () => {
        expect(isExactMatch('  Taylor Swift  ', 'Taylor Swift')).toBe(true);
        expect(isExactMatch('Taylor Swift', '  Taylor Swift  ')).toBe(true);
    });

    it('should return false for different names', () => {
        expect(isExactMatch('Taylor Swift', 'Taylor Swiftie')).toBe(false);
        expect(isExactMatch('Keli Holiday', 'Billie Holiday')).toBe(false);
    });
});

describe('verifyArtistMatch', () => {
    it('should return true for exact matches', () => {
        expect(verifyArtistMatch('Taylor Swift', 'Taylor Swift')).toBe(true);
    });

    it('should require exact match for single-word names', () => {
        // Single-word names must match exactly (prevents GREG → Greg Brown)
        expect(verifyArtistMatch('Taylor', 'Taylor Swift')).toBe(false);
        expect(verifyArtistMatch('Taylor', 'Taylor')).toBe(true);
        expect(verifyArtistMatch('Prince', 'Prince')).toBe(true);
    });

    it('should allow partial matches for multi-word names', () => {
        expect(verifyArtistMatch('Taylor Swift', 'Taylor Alison Swift')).toBe(true);
    });

    it('should return false for wrong artists', () => {
        expect(verifyArtistMatch('Keli Holiday', 'Billie Holiday')).toBe(false);
    });

    it('should handle slight variations', () => {
        expect(verifyArtistMatch('The Beatles', 'Beatles, The')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Country Code Helper Tests
// ---------------------------------------------------------------------------

describe('extractCountryCode', () => {
    it('should extract ISO 3166-1 codes', () => {
        expect(extractCountryCode({ 'iso-3166-1-codes': ['US'] })).toBe('US');
        expect(extractCountryCode({ 'iso-3166-1-codes': ['AU', 'GB'] })).toBe('AU');
    });

    it('should extract country from ISO 3166-2 codes', () => {
        expect(extractCountryCode({ 'iso-3166-2-codes': ['US-CA'] })).toBe('US');
        expect(extractCountryCode({ 'iso-3166-2-codes': ['AU-NSW'] })).toBe('AU');
    });

    it('should prefer ISO 3166-1 over ISO 3166-2', () => {
        expect(extractCountryCode({
            'iso-3166-1-codes': ['US'],
            'iso-3166-2-codes': ['AU-NSW']
        })).toBe('US');
    });

    it('should return null when no codes present', () => {
        expect(extractCountryCode({})).toBeNull();
        expect(extractCountryCode({ 'iso-3166-1-codes': [] })).toBeNull();
    });
});

describe('countryCodeToName', () => {
    it('should convert country codes to names', () => {
        expect(countryCodeToName('US')).toBe('United States');
        expect(countryCodeToName('AU')).toBe('Australia');
        expect(countryCodeToName('GB')).toBe('United Kingdom');
        expect(countryCodeToName('JP')).toBe('Japan');
    });

    it('should handle invalid codes gracefully', () => {
        // Note: Intl.DisplayNames returns the input for unknown codes, not null
        // So 'XX' returns 'XX', empty string returns null due to our try/catch
        const result = countryCodeToName('XX');
        // Accept either null or the code itself as valid behavior
        expect(result === null || result === 'XX').toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Display Name Helper Tests
// ---------------------------------------------------------------------------

describe('normalizeDisplayName', () => {
    it('should extract city and country from long display names', () => {
        expect(normalizeDisplayName('Osaka, Osaka Prefecture, Kinki Region, Japan'))
            .toBe('Osaka, Japan');
        expect(normalizeDisplayName('Sydney, New South Wales, Australia'))
            .toBe('Sydney, Australia');
    });

    it('should handle simple two-part names', () => {
        expect(normalizeDisplayName('Tokyo, Japan')).toBe('Tokyo, Japan');
    });

    it('should handle single-part names', () => {
        expect(normalizeDisplayName('Japan')).toBe('Japan');
    });
});

describe('cleanWikipediaLocation', () => {
    it('should remove wiki links', () => {
        expect(cleanWikipediaLocation('[[Sydney]]')).toBe('Sydney');
        expect(cleanWikipediaLocation('[[Sydney|Sydney, Australia]]')).toBe('Sydney');
    });

    it('should remove templates', () => {
        expect(cleanWikipediaLocation('Sydney{{citation needed}}')).toBe('Sydney');
    });

    it('should remove HTML tags', () => {
        expect(cleanWikipediaLocation('Sydney<br/>Australia')).toBe('SydneyAustralia');
    });

    it('should normalize whitespace', () => {
        expect(cleanWikipediaLocation('Sydney,  New South Wales')).toBe('Sydney, New South Wales');
    });

    it('should replace nbsp', () => {
        expect(cleanWikipediaLocation('New&nbsp;York')).toBe('New York');
    });

    it('should handle complex markup', () => {
        expect(cleanWikipediaLocation('[[Sydney]], [[New South Wales|NSW]], [[Australia]]'))
            .toBe('Sydney, New South Wales, Australia');
    });
});

// ---------------------------------------------------------------------------
// Fetch Helper Tests (with mocking)
// ---------------------------------------------------------------------------

describe('fetchWithRetry', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return response on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ data: 'test' })
        });

        const response = await fetchWithRetry('https://example.com', {});
        expect(response.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 status', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429 })
            .mockResolvedValueOnce({ ok: true });

        const response = await fetchWithRetry('https://example.com', {}, 2);
        expect(response.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 status', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true });

        const response = await fetchWithRetry('https://example.com', {}, 2);
        expect(response.ok).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on other error statuses', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

        const response = await fetchWithRetry('https://example.com', {}, 2);
        expect(response.ok).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return null after max retries', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

        const response = await fetchWithRetry('https://example.com', {}, 2);
        expect(response).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// MusicBrainz Fetch Tests
// ---------------------------------------------------------------------------

describe('fetchFromMusicBrainz', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return artist data when found', async () => {
        const mockResponse = {
            artists: [{
                name: 'Taylor Swift',
                'sort-name': 'Swift, Taylor',
                type: 'Person',
                score: 100,
                id: 'abc123',
                'begin-area': { name: 'West Reading', id: 'area1', type: 'City' },
                area: { name: 'United States', id: 'area2', type: 'Country' }
            }]
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse)
        });

        const result = await fetchFromMusicBrainz('Taylor Swift');
        expect(result).toEqual({
            beginArea: 'West Reading',
            beginAreaId: 'area1',
            beginAreaType: 'City',
            area: 'United States',
            areaId: 'area2',
            areaType: 'Country',
            mbid: 'abc123',
            artistName: 'Taylor Swift',
            artistType: 'Person'
        });
    });

    it('should skip low-score results', async () => {
        const mockResponse = {
            artists: [{
                name: 'Taylor Swift Tribute',
                'sort-name': 'Taylor Swift Tribute',
                score: 50,
                id: 'abc123'
            }]
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse)
        });

        const result = await fetchFromMusicBrainz('Taylor Swift');
        // Low score results are rejected, returns noMatch flag
        expect(result).toEqual({ noMatch: true });
    });

    it('should skip name mismatches', async () => {
        const mockResponse = {
            artists: [{
                name: 'Billie Holiday',
                'sort-name': 'Holiday, Billie',
                score: 90,
                id: 'abc123',
                area: { name: 'New York', id: 'area1', type: 'City' }
            }]
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse)
        });

        const result = await fetchFromMusicBrainz('Keli Holiday');
        // Name mismatches are rejected, returns noMatch flag
        expect(result).toEqual({ noMatch: true });
    });

    it('should return null on API error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500
        });

        const result = await fetchFromMusicBrainz('Taylor Swift');
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Geocoding Tests
// ---------------------------------------------------------------------------

describe('geocodeWithNominatim', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return coordinates and display name on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{
                lat: '-33.8688',
                lon: '151.2093',
                display_name: 'Sydney, New South Wales, Australia',
                addresstype: 'city'
            }])
        });

        const result = await geocodeWithNominatim('Sydney, Australia');
        expect(result).toEqual({
            coords: [-33.8688, 151.2093],
            displayName: 'Sydney, Australia',
            addressType: 'city'
        });
    });

    it('should return null on empty results', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([])
        });

        const result = await geocodeWithNominatim('Nonexistent Place');
        expect(result).toBeNull();
    });

    it('should return null on API error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500
        });

        const result = await geocodeWithNominatim('Sydney');
        expect(result).toBeNull();
    });
});

describe('geocodeWithPhoton', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return coordinates on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                features: [{
                    geometry: {
                        coordinates: [151.2093, -33.8688] // [lon, lat]
                    }
                }]
            })
        });

        const result = await geocodeWithPhoton('Sydney, Australia');
        expect(result).toEqual([-33.8688, 151.2093]); // [lat, lon]
    });

    it('should return null on empty results', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ features: [] })
        });

        const result = await geocodeWithPhoton('Nonexistent Place');
        expect(result).toBeNull();
    });
});

describe('geocodeLocation', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should use Nominatim result when available', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{
                lat: '-33.8688',
                lon: '151.2093',
                display_name: 'Sydney, New South Wales, Australia',
                addresstype: 'city'
            }])
        });

        const result = await geocodeLocation('Sydney, Australia');
        expect(result.coords).toEqual([-33.8688, 151.2093]);
        expect(result.displayName).toBe('Sydney, Australia');
    });

    it('should fall back to Photon when Nominatim fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // Nominatim empty
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    features: [{
                        geometry: { coordinates: [151.2093, -33.8688] }
                    }]
                })
            });

        const result = await geocodeLocation('Sydney');
        expect(result.coords).toEqual([-33.8688, 151.2093]);
        expect(result.displayName).toBe('Sydney');
    });

    it('should try simplified location when both fail', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // Nominatim for full
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ features: [] }) }) // Photon for full
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([{
                    lat: '-25.2744',
                    lon: '133.7751',
                    display_name: 'Australia',
                    addresstype: 'country'
                }])
            }); // Nominatim for country

        const result = await geocodeLocation('Unknown City, Australia');
        expect(result.displayName).toBe('Australia');
    });
});

// ---------------------------------------------------------------------------
// Wikipedia/Wikidata Tests
// ---------------------------------------------------------------------------

describe('fetchFromWikipedia', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should extract origin from infobox', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    query: {
                        search: [{ title: 'The Beatles' }]
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    parse: {
                        wikitext: {
                            '*': '| origin = [[Liverpool]], [[England]]'
                        }
                    }
                })
            });

        const result = await fetchFromWikipedia('The Beatles');
        expect(result).toBe('Liverpool, England');
    });

    it('should extract birth_place for solo artists', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    query: {
                        search: [{ title: 'Taylor Swift' }]
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    parse: {
                        wikitext: {
                            '*': '| birth_place = [[West Reading, Pennsylvania]], U.S.'
                        }
                    }
                })
            });

        const result = await fetchFromWikipedia('Taylor Swift');
        expect(result).toBe('West Reading, Pennsylvania, U.S.');
    });

    it('should return null when no match found', async () => {
        global.fetch = vi.fn().mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ query: { search: [] } })
        });

        const result = await fetchFromWikipedia('Nonexistent Artist');
        expect(result).toBeNull();
    });
});

describe('fetchFromWikidata', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return place label on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                results: {
                    bindings: [{
                        placeLabel: { value: 'West Reading' }
                    }]
                }
            })
        });

        const result = await fetchFromWikidata('Taylor Swift');
        expect(result).toBe('West Reading');
    });

    it('should try band query when person query fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ results: { bindings: [] } })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    results: {
                        bindings: [{
                            placeLabel: { value: 'Liverpool' }
                        }]
                    }
                })
            });

        const result = await fetchFromWikidata('The Beatles');
        expect(result).toBe('Liverpool');
    });

    it('should return null when nothing found', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ results: { bindings: [] } })
        });

        const result = await fetchFromWikidata('Unknown Artist');
        expect(result).toBeNull();
    });
});

describe('fetchSubdivisionCapital', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should return capital city', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                results: {
                    bindings: [{
                        capitalLabel: { value: 'Perth' }
                    }]
                }
            })
        });

        const result = await fetchSubdivisionCapital('Western Australia');
        expect(result).toBe('Perth');
    });

    it('should return null when not found', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ results: { bindings: [] } })
        });

        const result = await fetchSubdivisionCapital('Unknown Region');
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Main Orchestrator Integration Tests
// ---------------------------------------------------------------------------

describe('resolveArtistLocation', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('should resolve city-level MusicBrainz data directly', async () => {
        // Mock MusicBrainz artist search
        const mbSearchResponse = {
            artists: [{
                name: 'Taylor Swift',
                'sort-name': 'Swift, Taylor',
                score: 100,
                id: 'abc123',
                'begin-area': { name: 'West Reading', id: 'area1', type: 'City' },
                area: { name: 'United States', id: 'area2', type: 'Country' }
            }]
        };

        // Mock area lookup (returns US code)
        const areaLookupResponse = {
            'iso-3166-1-codes': ['US']
        };

        // Mock geocoding
        const geocodeResponse = [{
            lat: '40.3354',
            lon: '-75.9263',
            display_name: 'West Reading, Pennsylvania, United States',
            addresstype: 'city'
        }];

        let callCount = 0;
        global.fetch = vi.fn().mockImplementation((url) => {
            callCount++;
            if (url.includes('musicbrainz.org/ws/2/artist/?query=')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mbSearchResponse)
                });
            }
            if (url.includes('musicbrainz.org/ws/2/area/')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(areaLookupResponse)
                });
            }
            if (url.includes('nominatim')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(geocodeResponse)
                });
            }
            return Promise.resolve({ ok: false });
        });

        const result = await resolveArtistLocation('Taylor Swift');
        expect(result.location_name).toBe('West Reading, United States');
        expect(result.location_coord).toEqual([40.3354, -75.9263]);
    });

    it('should return Unknown when nothing found', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ artists: [] })
        });

        const result = await resolveArtistLocation('Completely Unknown Artist XYZ123');
        expect(result.location_name).toBe('Unknown');
        expect(result.location_coord).toBeNull();
    });
});
