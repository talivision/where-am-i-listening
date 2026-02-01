/**
 * Cloudflare Worker for Artist Location Service
 *
 * Fetches artist origin locations from MusicBrainz and Wikidata,
 * geocodes them with Nominatim, and caches results in KV.
 */

import {
    resolveArtistLocation,
    geocodeLocation
} from '../../shared/location-resolver.js';

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

// CORS headers for browser requests
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

                // Pre-check cache for all artists
                const cachedResults = {};
                const uncachedArtists = [];
                if (env.ARTIST_CACHE) {
                    for (const name of limitedArtists) {
                        const cacheKey = `artist:${name.toLowerCase()}`;
                        try {
                            const cached = await env.ARTIST_CACHE.get(cacheKey, 'json');
                            if (cached && (cached.location_coord || cached.location_name === 'Unknown')) {
                                cachedResults[name] = cached;
                                continue;
                            }
                        } catch (e) { /* fall through */ }
                        uncachedArtists.push(name);
                    }
                } else {
                    uncachedArtists.push(...limitedArtists);
                }

                // Stream results back as NDJSON — cached results arrive instantly,
                // uncached ones trickle in as they're resolved
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    async start(controller) {
                        try {
                            // Flush cached results immediately
                            for (const [name, data] of Object.entries(cachedResults)) {
                                controller.enqueue(encoder.encode(
                                    JSON.stringify({ artist: name, ...data }) + '\n'
                                ));
                            }

                            // Process uncached artists sequentially
                            for (let i = 0; i < uncachedArtists.length; i++) {
                                const name = uncachedArtists[i];
                                const result = await getArtistLocation(name, env);
                                controller.enqueue(encoder.encode(
                                    JSON.stringify({ artist: name, ...result }) + '\n'
                                ));
                                if (i < uncachedArtists.length - 1) {
                                    await new Promise(r => setTimeout(r, 500));
                                }
                            }
                        } catch (e) {
                            console.error('Stream error:', e);
                        } finally {
                            controller.close();
                        }
                    }
                });

                return new Response(stream, {
                    headers: { ...corsHeaders, 'Content-Type': 'application/x-ndjson' }
                });

            } catch (error) {
                console.error('Error processing request:', error);
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // Delete cached artists
        if (url.pathname === '/api/cache' && request.method === 'DELETE') {
            try {
                const body = await request.json();
                const artists = body.artists || [];

                if (!Array.isArray(artists) || artists.length === 0) {
                    return new Response(JSON.stringify({ error: 'Invalid artists array' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const deleted = [];
                if (env.ARTIST_CACHE) {
                    for (const name of artists) {
                        const cacheKey = `artist:${name.toLowerCase()}`;
                        await env.ARTIST_CACHE.delete(cacheKey);
                        deleted.push(name);
                    }
                }

                return new Response(JSON.stringify({ deleted }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (error) {
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
                    const geoResult = await geocodeLocation(cached.location_name);
                    if (geoResult) {
                        cached.location_coord = geoResult.coords;
                        cached.location_name = geoResult.displayName;
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

    // Use shared resolver
    const result = await resolveArtistLocation(artistName);

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
