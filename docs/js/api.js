/**
 * API Client for Artist Location Service
 * Communicates with Cloudflare Worker backend to get artist locations
 */

import { resolveArtistLocation } from '/shared/location-resolver.js';

// Configuration - update this with your deployed Worker URL
const API_CONFIG = {
    // Checks localStorage first, then tries local worker, then falls back to placeholder
    baseUrl: localStorage.getItem('api_base_url') || 'https://where-am-i-listening.YOUR_SUBDOMAIN.workers.dev',
    localWorkerUrl: 'http://localhost:8787',
    cacheKey: 'artist_locations_cache',
    cacheExpiry: 30 * 24 * 60 * 60 * 1000 // 30 days in ms
};

/**
 * Get cached locations from localStorage
 */
function getCache() {
    try {
        const cached = localStorage.getItem(API_CONFIG.cacheKey);
        if (!cached) return {};
        const data = JSON.parse(cached);
        // Check if cache is expired
        if (data.timestamp && Date.now() - data.timestamp > API_CONFIG.cacheExpiry) {
            localStorage.removeItem(API_CONFIG.cacheKey);
            return {};
        }
        return data.locations || {};
    } catch (e) {
        return {};
    }
}

/**
 * Save locations to localStorage cache
 */
function saveToCache(locations) {
    try {
        const existing = getCache();
        const merged = { ...existing, ...locations };
        localStorage.setItem(API_CONFIG.cacheKey, JSON.stringify({
            timestamp: Date.now(),
            locations: merged
        }));
    } catch (e) {
        console.warn('Failed to save to cache:', e);
    }
}

/**
 * Check if a worker URL is properly configured (not a placeholder)
 */
function isWorkerConfigured() {
    return API_CONFIG.baseUrl &&
           !API_CONFIG.baseUrl.includes('YOUR_SUBDOMAIN') &&
           !API_CONFIG.baseUrl.includes('example');
}

/**
 * Try to detect and use local worker if running.
 * Only checks when running on localhost (development).
 */
async function detectLocalWorker() {
    // Skip detection on production - localhost worker won't be available
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return null;
    }

    try {
        const response = await fetch(`${API_CONFIG.localWorkerUrl}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(1000) // 1 second timeout
        });
        if (response.ok) {
            console.log('Local worker detected at', API_CONFIG.localWorkerUrl);
            return API_CONFIG.localWorkerUrl;
        }
    } catch (e) {
        // Local worker not running
    }
    return null;
}

/**
 * Fetch artist locations - uses Worker if configured, otherwise direct fetch
 * @param {Array} artists - Array of artist objects with name property
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<Array>} Artists with location data
 */
async function fetchArtistLocations(artists, onProgress = null) {
    // Try local worker first (for development)
    const localWorker = await detectLocalWorker();
    if (localWorker) {
        API_CONFIG.baseUrl = localWorker;
    }

    // If no worker configured, use direct fetch
    if (!localWorker && !isWorkerConfigured()) {
        console.log('No worker configured, using direct MusicBrainz/Nominatim fetch');
        return fetchLocationsDirectly(artists, onProgress);
    }

    const cache = getCache();
    const results = [];
    const uncached = [];

    // Check cache first
    for (const artist of artists) {
        if (cache[artist.name]) {
            results.push({
                ...artist,
                ...cache[artist.name]
            });
        } else {
            uncached.push(artist);
        }
    }

    if (onProgress) {
        onProgress({
            type: 'cache',
            cached: results.length,
            remaining: uncached.length
        });
    }

    // If all cached, return early
    if (uncached.length === 0) {
        return results;
    }

    // Notify that we're using the worker
    if (onProgress) {
        onProgress({ type: 'worker-mode' });
    }

    const newLocations = {};
    let processed = 0;

    // Build a lookup map for uncached artists by name
    const uncachedByName = {};
    for (const artist of uncached) {
        uncachedByName[artist.name] = artist;
    }

    try {
        // Send all uncached artists in a single request — the worker
        // streams results back as NDJSON so cached ones arrive instantly
        const response = await fetch(`${API_CONFIG.baseUrl}/api/artists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artists: uncached.map(a => a.name) })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        // Read NDJSON stream — each line is one artist result
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                const data = JSON.parse(line);
                const artistName = data.artist;
                const artist = uncachedByName[artistName];
                if (!artist) continue;

                const locationData = {
                    location_name: data.location_name || 'Unknown',
                    location_coord: data.location_coord || null
                };

                newLocations[artistName] = locationData;
                results.push({ ...artist, ...locationData });
                processed++;

                saveToCache({ [artistName]: locationData });

                if (onProgress) {
                    onProgress({
                        type: 'progress',
                        current: processed,
                        total: uncached.length,
                        artist: artistName
                    });
                }
            }
        }

        if (onProgress) {
            onProgress({
                type: 'complete',
                total: results.length
            });
        }

        return results;

    } catch (error) {
        console.error('Worker failed, falling back to direct fetch:', error);
        // Fall back to direct fetch on worker error
        return fetchLocationsDirectly(artists, onProgress);
    }
}

/**
 * Fetch locations directly from browser (fallback)
 * Uses shared location resolver module with rate-limited queues
 */
async function fetchLocationsDirectly(artists, onProgress = null) {
    const cache = getCache();
    const results = [];

    // Notify UI that we're using direct mode
    if (onProgress) {
        onProgress({ type: 'direct-mode' });
    }

    for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];

        if (onProgress) {
            onProgress({
                type: 'progress',
                current: i + 1,
                total: artists.length,
                artist: artist.name
            });
        }

        // Check cache first
        if (cache[artist.name]) {
            results.push({ ...artist, ...cache[artist.name] });
            continue;
        }

        try {
            // Use shared resolver (rate-limited internally)
            const locationData = await resolveArtistLocation(artist.name);

            saveToCache({ [artist.name]: locationData });
            results.push({ ...artist, ...locationData });

        } catch (error) {
            console.warn(`Failed to fetch location for ${artist.name}:`, error);
            results.push({
                ...artist,
                location_name: 'Unknown',
                location_coord: null
            });
        }
    }

    return results;
}

/**
 * Clear the local cache
 */
function clearCache() {
    localStorage.removeItem(API_CONFIG.cacheKey);
}

/**
 * Set the API base URL (for development)
 */
function setApiBaseUrl(url) {
    localStorage.setItem('api_base_url', url);
    API_CONFIG.baseUrl = url;
}

// Export for ES modules
export {
    fetchArtistLocations,
    fetchLocationsDirectly,
    clearCache,
    setApiBaseUrl,
    getCache
};

// Export for use in inline scripts via window
window.LocationAPI = {
    fetchArtistLocations,
    fetchLocationsDirectly,
    clearCache,
    setApiBaseUrl,
    getCache
};
