/**
 * Cloudflare Worker for Artist Location Service
 *
 * Fetches artist origin locations from MusicBrainz and Wikidata,
 * geocodes them with Nominatim, and caches results in KV.
 */

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const USER_AGENT = 'WhereAmIListening/2.0 (https://github.com/talidemestre/where-am-i-listening)';

// CORS headers for browser requests
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);

        // Health check
        if (url.pathname === '/health') {
            return new Response('OK', {
                headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
            });
        }

        // Main API endpoint
        if (url.pathname === '/api/artists' && request.method === 'POST') {
            try {
                const body = await request.json();
                const artists = body.artists || [];

                if (!Array.isArray(artists) || artists.length === 0) {
                    return new Response(JSON.stringify({ error: 'Invalid artists array' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // Limit to 50 artists per request
                const limitedArtists = artists.slice(0, 50);

                // Process artists sequentially to respect API rate limits
                // (MusicBrainz, Wikipedia, Nominatim all have ~1 req/sec limits)
                const results = {};
                const CONCURRENCY = 1;

                for (let i = 0; i < limitedArtists.length; i += CONCURRENCY) {
                    const batch = limitedArtists.slice(i, i + CONCURRENCY);
                    const batchPromises = batch.map(async (artistName) => {
                        const location = await getArtistLocation(artistName, env);
                        results[artistName] = location;
                    });
                    await Promise.all(batchPromises);

                    // Small delay between batches to avoid rate limiting
                    if (i + CONCURRENCY < limitedArtists.length) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                return new Response(JSON.stringify(results), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });

            } catch (error) {
                console.error('Error processing request:', error);
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 404 for unknown routes
        return new Response('Not Found', {
            status: 404,
            headers: corsHeaders
        });
    }
};

/**
 * Get artist location, using cache if available
 */
async function getArtistLocation(artistName, env) {
    // Check cache first (if KV is available)
    const cacheKey = `artist:${artistName.toLowerCase()}`;

    if (env.ARTIST_CACHE) {
        try {
            const cached = await env.ARTIST_CACHE.get(cacheKey, 'json');
            if (cached) {
                // Retry geocoding if we have a location name but no coordinates
                if (cached.location_name && cached.location_name !== 'Unknown' && !cached.location_coord) {
                    console.log(`Cache hit (retrying geocoding): ${artistName}`);
                    const coords = await geocodeLocation(cached.location_name);
                    if (coords) {
                        cached.location_coord = coords;
                        // Update cache with new coordinates
                        await env.ARTIST_CACHE.put(cacheKey, JSON.stringify(cached), {
                            expirationTtl: CACHE_TTL
                        });
                    }
                } else {
                    console.log(`Cache hit: ${artistName}`);
                }
                return cached;
            }
        } catch (e) {
            console.warn('Cache read error:', e);
        }
    }

    console.log(`Cache miss: ${artistName}`);

    // Fetch from external sources using fallback chain like original implementation
    let location = null;

    // Try MusicBrainz first
    location = await fetchFromMusicBrainz(artistName);

    // Fallback to Wikipedia with different search strategies
    if (!location) {
        location = await fetchFromWikipedia(artistName + ' musician');
    }
    if (!location) {
        location = await fetchFromWikipedia(artistName + ' band');
    }
    if (!location) {
        location = await fetchFromWikipedia(artistName);
    }

    // Final fallback to Wikidata SPARQL
    if (!location) {
        location = await fetchFromWikidata(artistName);
    }

    // Build result
    let result;
    if (location) {
        // Geocode the location
        const coords = await geocodeLocation(location);
        result = {
            location_name: location,
            location_coord: coords
        };
    } else {
        result = {
            location_name: 'Unknown',
            location_coord: null
        };
    }

    // Cache the result (if KV is available)
    if (env.ARTIST_CACHE) {
        try {
            await env.ARTIST_CACHE.put(cacheKey, JSON.stringify(result), {
                expirationTtl: CACHE_TTL
            });
        } catch (e) {
            console.warn('Cache write error:', e);
        }
    }

    return result;
}

/**
 * Verify the returned artist name matches our search query
 * Uses word matching to detect wrong artists (e.g., "Keli Holiday" vs "Billie Holiday")
 */
function verifyArtistMatch(searchName, resultName) {
    const searchWords = searchName.toLowerCase().split(/\s+/);
    const resultLower = resultName.toLowerCase();

    let missingWords = 0;
    for (const word of searchWords) {
        // Check if word exists in result (allowing for slight variations)
        if (!resultLower.includes(word) && !resultLower.includes(word.slice(0, -2))) {
            missingWords++;
        }
    }

    const mismatchRatio = missingWords / searchWords.length;
    return mismatchRatio <= 0.4; // Allow up to 40% words missing
}

/**
 * Fetch with retry logic for rate limiting
 */
async function fetchWithRetry(url, options, maxRetries = 2) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(url, options);

        if (response.ok) {
            return response;
        }

        // Rate limited - wait and retry (shorter delays since we throttle at batch level)
        if (response.status === 429 || response.status === 503) {
            const delay = (attempt + 1) * 500; // 500ms, 1s
            console.log(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
        }

        // Other error - don't retry
        return response;
    }

    return null;
}

/**
 * Fetch artist location from MusicBrainz API
 */
async function fetchFromMusicBrainz(artistName) {
    try {
        const encodedName = encodeURIComponent(artistName);
        const response = await fetchWithRetry(
            `https://musicbrainz.org/ws/2/artist/?query=artist:${encodedName}&limit=5&fmt=json`,
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response || !response.ok) {
            console.warn(`MusicBrainz error for ${artistName}: ${response?.status || 'no response'}`);
            return null;
        }

        const data = await response.json();

        // Check multiple results to find the right artist
        for (const artist of (data.artists || [])) {
            // Verify score is high enough
            if (artist.score < 70) {
                continue;
            }

            // Verify the name actually matches (prevents "Keli Holiday" -> "Billie Holiday")
            const sortName = artist['sort-name'] || artist.name || '';
            if (!verifyArtistMatch(artistName, sortName)) {
                console.log(`Name mismatch for ${artistName}: got ${sortName}, skipping`);
                continue;
            }

            console.log(`Matched ${artistName} to ${artist.name} (score: ${artist.score})`);

            // Try begin-area first (city of origin), then area (country)
            if (artist['begin-area'] && artist['begin-area'].name) {
                // Combine begin-area with country if available
                if (artist.area && artist.area.name && artist.area.name !== artist['begin-area'].name) {
                    return `${artist['begin-area'].name}, ${artist.area.name}`;
                }
                return artist['begin-area'].name;
            }

            if (artist.area && artist.area.name) {
                return artist.area.name;
            }
        }

        return null;

    } catch (error) {
        console.error(`MusicBrainz fetch error for ${artistName}:`, error);
        return null;
    }
}

/**
 * Fetch artist location from Wikipedia API
 * Searches for the artist page and extracts origin/birthplace from infobox
 */
async function fetchFromWikipedia(searchQuery) {
    try {
        // Search Wikipedia for the page
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&format=json&origin=*`;
        const searchResponse = await fetch(searchUrl, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!searchResponse.ok) return null;
        const searchData = await searchResponse.json();

        if (!searchData.query?.search?.length) return null;

        const pageTitle = searchData.query.search[0].title;

        // Get the page content with infobox data via parse API
        const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&section=0&format=json&origin=*`;
        const parseResponse = await fetch(parseUrl, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!parseResponse.ok) return null;
        const parseData = await parseResponse.json();

        const wikitext = parseData.parse?.wikitext?.['*'] || '';

        // Extract origin from infobox - look for common patterns
        // Try "origin" field first (for bands)
        let match = wikitext.match(/\|\s*origin\s*=\s*([^\n\|]+)/i);
        if (match) {
            return cleanWikipediaLocation(match[1]);
        }

        // Try "birth_place" field (for solo artists)
        match = wikitext.match(/\|\s*birth_place\s*=\s*([^\n\|]+)/i);
        if (match) {
            return cleanWikipediaLocation(match[1]);
        }

        // Try "birthplace" field
        match = wikitext.match(/\|\s*birthplace\s*=\s*([^\n\|]+)/i);
        if (match) {
            return cleanWikipediaLocation(match[1]);
        }

        return null;

    } catch (error) {
        console.error(`Wikipedia fetch error for ${searchQuery}:`, error);
        return null;
    }
}

/**
 * Clean up Wikipedia location text (remove wiki markup)
 */
function cleanWikipediaLocation(text) {
    return text
        .replace(/\[\[([^\|\]]+)\|?[^\]]*\]\]/g, '$1') // [[Link|Text]] -> Link
        .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fetch artist location from Wikidata SPARQL
 */
async function fetchFromWikidata(artistName) {
    try {
        // SPARQL query to find artist and their place of birth or formation
        const sparql = `
            SELECT ?placeLabel WHERE {
                ?artist wdt:P31 wd:Q5 ;
                        rdfs:label "${artistName.replace(/"/g, '\\"')}"@en .
                { ?artist wdt:P19 ?place . }
                UNION
                { ?artist wdt:P740 ?place . }
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
            }
            LIMIT 1
        `;

        const response = await fetch(
            `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/sparql-results+json'
                }
            }
        );

        if (!response.ok) {
            console.warn(`Wikidata error for ${artistName}: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (data.results?.bindings?.length > 0) {
            return data.results.bindings[0].placeLabel?.value;
        }

        // Try searching for bands/groups
        const bandSparql = `
            SELECT ?placeLabel WHERE {
                ?artist wdt:P31 wd:Q215380 ;
                        rdfs:label "${artistName.replace(/"/g, '\\"')}"@en .
                ?artist wdt:P740 ?place .
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
            }
            LIMIT 1
        `;

        const bandResponse = await fetch(
            `https://query.wikidata.org/sparql?query=${encodeURIComponent(bandSparql)}&format=json`,
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/sparql-results+json'
                }
            }
        );

        if (bandResponse.ok) {
            const bandData = await bandResponse.json();
            if (bandData.results?.bindings?.length > 0) {
                return bandData.results.bindings[0].placeLabel?.value;
            }
        }

        return null;

    } catch (error) {
        console.error(`Wikidata fetch error for ${artistName}:`, error);
        return null;
    }
}

/**
 * Geocode a location name to coordinates
 * Tries Nominatim first, falls back to Photon (both free, OSM-based)
 */
async function geocodeLocation(locationName) {
    // Try Nominatim first
    let coords = await geocodeWithNominatim(locationName);
    if (coords) return coords;

    // Fallback to Photon
    coords = await geocodeWithPhoton(locationName);
    if (coords) return coords;

    // Try simplified location (just country)
    if (locationName.includes(',')) {
        const parts = locationName.split(',');
        const country = parts[parts.length - 1].trim();
        coords = await geocodeWithNominatim(country);
        if (coords) return coords;
        coords = await geocodeWithPhoton(country);
        if (coords) return coords;
    }

    return null;
}

async function geocodeWithNominatim(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            { headers: { 'User-Agent': USER_AGENT } }
        );
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
    } catch (e) {
        console.warn('Nominatim error:', e.message);
    }
    return null;
}

async function geocodeWithPhoton(query) {
    try {
        console.log(`Photon geocoding: ${query}`);
        const response = await fetch(
            `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`,
            { headers: { 'User-Agent': USER_AGENT } }
        );
        console.log(`Photon response status: ${response.status}`);
        if (!response.ok) return null;
        const data = await response.json();
        console.log(`Photon features: ${data.features?.length || 0}`);
        if (data.features && data.features.length > 0) {
            const [lon, lat] = data.features[0].geometry.coordinates;
            console.log(`Photon coords: ${lat}, ${lon}`);
            return [lat, lon];
        }
    } catch (e) {
        console.warn('Photon error:', e.message);
    }
    return null;
}
