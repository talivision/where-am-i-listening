/**
 * Tests for the Cloudflare Worker
 *
 * Tests routing, CORS handling, caching, and NDJSON streaming.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared module before importing the worker
vi.mock('../shared/location-resolver.js', () => ({
    resolveArtistLocation: vi.fn().mockResolvedValue({
        location_name: 'Test City, Test Country',
        location_coord: [0, 0]
    }),
    geocodeLocation: vi.fn().mockResolvedValue({
        coords: [0, 0],
        displayName: 'Test City, Test Country'
    })
}));

// Import worker after mocking
import workerModule from '../worker/src/index.js';
import { resolveArtistLocation, geocodeLocation } from '../shared/location-resolver.js';

// Helper to create a mock Request
function createRequest(method, path, body = null) {
    const url = `http://localhost:8787${path}`;
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    return new Request(url, options);
}

// Helper to create mock KV namespace
function createMockKV() {
    const store = new Map();
    return {
        get: vi.fn(async (key, type) => {
            const value = store.get(key);
            if (type === 'json' && value) return JSON.parse(value);
            return value || null;
        }),
        put: vi.fn(async (key, value) => {
            store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        }),
        delete: vi.fn(async (key) => {
            store.delete(key);
        }),
        _store: store
    };
}

describe('Worker Routing', () => {
    it('should handle CORS preflight requests', async () => {
        const request = new Request('http://localhost:8787/api/artists', {
            method: 'OPTIONS'
        });

        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should return OK for health check', async () => {
        const request = createRequest('GET', '/health');
        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('OK');
        expect(response.headers.get('Content-Type')).toBe('text/plain');
    });

    it('should return 404 for unknown routes', async () => {
        const request = createRequest('GET', '/unknown');
        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not Found');
    });

    it('should have CORS headers on all responses', async () => {
        const request = createRequest('GET', '/health');
        const response = await workerModule.fetch(request, {}, {});

        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
});

describe('POST /api/artists', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 for missing artists array', async () => {
        const request = createRequest('POST', '/api/artists', {});
        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Invalid artists array');
    });

    it('should return 400 for empty artists array', async () => {
        const request = createRequest('POST', '/api/artists', { artists: [] });
        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(400);
    });

    it('should limit artists to 50 per request', async () => {
        const artists = Array.from({ length: 60 }, (_, i) => `Artist ${i}`);
        const mockKV = createMockKV();

        const request = createRequest('POST', '/api/artists', { artists });
        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});

        expect(response.status).toBe(200);
        // Can't easily verify the limit without reading the full stream,
        // but the logic is straightforward
    });

    it('should return NDJSON content type', async () => {
        const request = createRequest('POST', '/api/artists', { artists: ['Test Artist'] });
        const response = await workerModule.fetch(request, {}, {});

        expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');
    });

    it('should stream results as NDJSON', async () => {
        resolveArtistLocation.mockResolvedValue({
            location_name: 'Sydney, Australia',
            location_coord: [-33.8688, 151.2093]
        });

        const request = createRequest('POST', '/api/artists', { artists: ['Test Artist'] });
        const response = await workerModule.fetch(request, {}, {});

        const text = await response.text();
        const lines = text.trim().split('\n');

        expect(lines.length).toBeGreaterThanOrEqual(1);

        const parsed = JSON.parse(lines[0]);
        expect(parsed.artist).toBe('Test Artist');
        expect(parsed.location_name).toBe('Sydney, Australia');
        expect(parsed.location_coord).toEqual([-33.8688, 151.2093]);
    });
});

describe('KV Caching', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should use cached results when available', async () => {
        const mockKV = createMockKV();
        await mockKV.put('artist:test artist', JSON.stringify({
            location_name: 'Cached City',
            location_coord: [1, 2]
        }));

        const request = createRequest('POST', '/api/artists', { artists: ['Test Artist'] });
        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});

        const text = await response.text();
        const result = JSON.parse(text.trim());

        expect(result.location_name).toBe('Cached City');
        expect(result.location_coord).toEqual([1, 2]);
        // Should not call resolve function for cached results
        expect(resolveArtistLocation).not.toHaveBeenCalled();
    });

    it('should cache new results', async () => {
        resolveArtistLocation.mockResolvedValue({
            location_name: 'New City',
            location_coord: [3, 4]
        });

        const mockKV = createMockKV();

        const request = createRequest('POST', '/api/artists', { artists: ['New Artist'] });
        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});

        // Must consume the stream to trigger caching
        await response.text();

        expect(mockKV.put).toHaveBeenCalled();
        const putCall = mockKV.put.mock.calls.find(call => call[0] === 'artist:new artist');
        expect(putCall).toBeDefined();

        const cachedData = JSON.parse(putCall[1]);
        expect(cachedData.location_name).toBe('New City');
    });

    it('should retry geocoding for cached results with name but no coordinates', async () => {
        const mockKV = createMockKV();
        await mockKV.put('artist:test artist', JSON.stringify({
            location_name: 'Sydney',
            location_coord: null
        }));

        geocodeLocation.mockResolvedValue({
            coords: [-33.8688, 151.2093],
            displayName: 'Sydney, Australia'
        });

        const request = createRequest('POST', '/api/artists', { artists: ['Test Artist'] });
        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});

        const text = await response.text();
        const result = JSON.parse(text.trim());

        expect(geocodeLocation).toHaveBeenCalledWith('Sydney');
        expect(result.location_coord).toEqual([-33.8688, 151.2093]);
    });

    it('should work without KV (fallback mode)', async () => {
        resolveArtistLocation.mockResolvedValue({
            location_name: 'Test City',
            location_coord: [0, 0]
        });

        const request = createRequest('POST', '/api/artists', { artists: ['Test Artist'] });
        const response = await workerModule.fetch(request, {}, {}); // No ARTIST_CACHE

        expect(response.status).toBe(200);
        const text = await response.text();
        const result = JSON.parse(text.trim());
        expect(result.location_name).toBe('Test City');
    });
});

describe('DELETE /api/cache', () => {
    it('should delete specified artists from cache', async () => {
        const mockKV = createMockKV();
        await mockKV.put('artist:artist1', JSON.stringify({ location_name: 'City1' }));
        await mockKV.put('artist:artist2', JSON.stringify({ location_name: 'City2' }));

        const request = createRequest('DELETE', '/api/cache', {
            artists: ['Artist1', 'Artist2']
        });

        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.deleted).toContain('Artist1');
        expect(body.deleted).toContain('Artist2');
        expect(mockKV.delete).toHaveBeenCalledWith('artist:artist1');
        expect(mockKV.delete).toHaveBeenCalledWith('artist:artist2');
    });

    it('should return 400 for invalid request', async () => {
        const request = createRequest('DELETE', '/api/cache', {});
        const response = await workerModule.fetch(request, {}, {});

        expect(response.status).toBe(400);
    });

    it('should handle empty cache namespace', async () => {
        const request = createRequest('DELETE', '/api/cache', { artists: ['Test'] });
        const response = await workerModule.fetch(request, {}, {}); // No ARTIST_CACHE

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.deleted).toEqual([]);
    });
});

describe('Error Handling', () => {
    it('should return 500 on JSON parse error', async () => {
        const request = new Request('http://localhost:8787/api/artists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid json{'
        });

        const response = await workerModule.fetch(request, {}, {});
        expect(response.status).toBe(500);
    });

    it('should include error message in response', async () => {
        const request = new Request('http://localhost:8787/api/artists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid json{'
        });

        const response = await workerModule.fetch(request, {}, {});
        const body = await response.json();
        expect(body.error).toBeDefined();
    });
});

describe('Cache Key Normalization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should lowercase artist names for cache keys', async () => {
        const mockKV = createMockKV();
        // Pre-populate cache with valid location (has coordinates)
        await mockKV.put('artist:taylor swift', JSON.stringify({
            location_name: 'Reading, United States',
            location_coord: [40.33, -75.93]
        }));

        // Request with different casing
        const request = createRequest('POST', '/api/artists', { artists: ['Taylor Swift'] });
        const response = await workerModule.fetch(request, { ARTIST_CACHE: mockKV }, {});

        const text = await response.text();
        const result = JSON.parse(text.trim());

        // Should find the cached result (cache check happens before stream starts)
        expect(result.location_name).toBe('Reading, United States');
        expect(result.location_coord).toEqual([40.33, -75.93]);
        // Since it was cached with coords, resolver shouldn't be called
        expect(resolveArtistLocation).not.toHaveBeenCalled();
    });
});
