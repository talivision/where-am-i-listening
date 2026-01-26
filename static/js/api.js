/**
 * API Client for Artist Location Service
 * Communicates with Cloudflare Worker backend to get artist locations
 */

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
 * Try to detect and use local worker if running
 */
async function detectLocalWorker() {
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

    // Fetch uncached artists from backend in batches for progress updates
    const BATCH_SIZE = 10;
    const newLocations = {};
    let processed = 0;

    try {
        for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
            const batch = uncached.slice(i, i + BATCH_SIZE);

            // Show which batch we're fetching
            if (onProgress) {
                onProgress({
                    type: 'progress',
                    current: processed,
                    total: uncached.length,
                    artist: `${batch[0].name}${batch.length > 1 ? ` +${batch.length - 1} more` : ''}`
                });
            }

            const response = await fetch(`${API_CONFIG.baseUrl}/api/artists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    artists: batch.map(a => a.name)
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();

            // Process response and merge with artist data
            for (const artist of batch) {
                const locationData = data[artist.name] || {
                    location_name: 'Unknown',
                    location_coord: null
                };

                newLocations[artist.name] = locationData;

                results.push({
                    ...artist,
                    ...locationData
                });

                processed++;
            }

            // Save batch to cache immediately
            saveToCache(newLocations);
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
 * Fetch locations directly from browser (fallback, slower due to rate limits)
 * Uses MusicBrainz and Nominatim directly
 */
async function fetchLocationsDirectly(artists, onProgress = null) {
    const cache = getCache();
    const results = [];

    // Notify UI that we're using direct mode (slow)
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

        // Check cache
        if (cache[artist.name]) {
            results.push({
                ...artist,
                ...cache[artist.name]
            });
            continue;
        }

        try {
            // Fetch from MusicBrainz (1 req/sec rate limit)
            const location = await fetchFromMusicBrainz(artist.name);

            if (location) {
                // Geocode the location using Nominatim
                const coords = await geocodeLocation(location);

                const locationData = {
                    location_name: location,
                    location_coord: coords
                };

                saveToCache({ [artist.name]: locationData });

                results.push({
                    ...artist,
                    ...locationData
                });
            } else {
                results.push({
                    ...artist,
                    location_name: 'Unknown',
                    location_coord: null
                });
            }

            // Rate limit: wait 1 second between requests
            await new Promise(resolve => setTimeout(resolve, 1100));

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
 * Verify the returned artist name matches our search query
 */
function verifyArtistMatch(searchName, resultName) {
    const searchWords = searchName.toLowerCase().split(/\s+/);
    const resultLower = resultName.toLowerCase();

    let missingWords = 0;
    for (const word of searchWords) {
        if (!resultLower.includes(word) && !resultLower.includes(word.slice(0, -2))) {
            missingWords++;
        }
    }

    return (missingWords / searchWords.length) <= 0.4;
}

/**
 * Fetch artist location from MusicBrainz API
 */
async function fetchFromMusicBrainz(artistName) {
    const encodedName = encodeURIComponent(artistName);
    const response = await fetch(
        `https://musicbrainz.org/ws/2/artist/?query=artist:${encodedName}&limit=5&fmt=json`,
        {
            headers: {
                'User-Agent': 'WhereAmIListening/2.0 (https://github.com/talidemestre/where-am-i-listening)'
            }
        }
    );

    if (!response.ok) {
        throw new Error(`MusicBrainz API error: ${response.status}`);
    }

    const data = await response.json();

    // Check multiple results to find the right artist
    for (const artist of (data.artists || [])) {
        // Verify score is high enough
        if (artist.score < 70) {
            continue;
        }

        // Verify name actually matches (prevents wrong artist matches)
        const sortName = artist['sort-name'] || artist.name || '';
        if (!verifyArtistMatch(artistName, sortName)) {
            console.log(`Name mismatch for ${artistName}: got ${sortName}, skipping`);
            continue;
        }

        console.log(`Matched ${artistName} to ${artist.name} (score: ${artist.score})`);

        // Try begin-area first (more specific), then area
        if (artist['begin-area']) {
            return artist['begin-area'].name;
        }
        if (artist.area) {
            return artist.area.name;
        }
    }

    return null;
}

/**
 * Geocode a location name to coordinates using Nominatim
 */
async function geocodeLocation(locationName) {
    const encodedLocation = encodeURIComponent(locationName);
    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodedLocation}&format=json&limit=1`,
        {
            headers: {
                'User-Agent': 'WhereAmIListening/2.0 (https://github.com/talidemestre/where-am-i-listening)'
            }
        }
    );

    if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json();

    if (data && data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }

    return null;
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

// Export for use in other modules
window.LocationAPI = {
    fetchArtistLocations,
    fetchLocationsDirectly,
    clearCache,
    setApiBaseUrl,
    getCache
};
