/**
 * Shared Location Resolution Module
 *
 * Contains all logic for resolving artist locations from MusicBrainz,
 * Wikipedia, Wikidata, and geocoding services.
 *
 * Used by both the Cloudflare Worker and browser fallback.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const USER_AGENT = 'WhereAmIListening/2.0 (https://github.com/talidemestre/where-am-i-listening)';
export const IS_PERSON_TYPE_ID = 'dd9886f2-1dfe-4270-97db-283f6839a666';

// ---------------------------------------------------------------------------
// Area specificity helpers
// ---------------------------------------------------------------------------

/**
 * Return a numeric specificity ranking for a MusicBrainz area type.
 * Higher = more specific.
 */
export function areaSpecificity(areaType) {
    if (!areaType) return -1;
    switch (areaType.toLowerCase()) {
        case 'country': return 0;
        case 'subdivision': return 1;
        case 'county': return 2;
        case 'city':
        case 'municipality':
        case 'district':
        case 'town':
        case 'village':
        case 'island':
            return 3;
        default: return 1; // unknown, treat as subdivision
    }
}

/**
 * Choose the best area between begin-area and area.
 * Prefers area when it is at least as specific as begin-area.
 * Returns { name, id, type } or null.
 */
export function chooseBestArea(mbResult) {
    if (!mbResult.beginArea && !mbResult.area) return null;

    const beginSpec = mbResult.beginArea ? areaSpecificity(mbResult.beginAreaType) : -2;
    const areaSpec = mbResult.area ? areaSpecificity(mbResult.areaType) : -2;

    // Prefer area when at least as specific as begin-area
    if (mbResult.area && areaSpec >= beginSpec) {
        return { name: mbResult.area, id: mbResult.areaId, type: mbResult.areaType };
    }
    if (mbResult.beginArea) {
        return { name: mbResult.beginArea, id: mbResult.beginAreaId, type: mbResult.beginAreaType };
    }
    return { name: mbResult.area, id: mbResult.areaId, type: mbResult.areaType };
}

/**
 * Check whether an area type is city-level (specific enough to geocode directly).
 */
export function isCityLevel(areaType) {
    return areaSpecificity(areaType) >= 3;
}

/**
 * Check whether a Nominatim geocode result is city-level.
 * Nominatim returns addresstype like "city", "town", "village", "suburb", etc.
 */
export function isCityLevelGeocode(geoResult) {
    if (!geoResult || !geoResult.addressType) return false;
    const cityTypes = ['city', 'town', 'village', 'municipality', 'suburb', 'neighbourhood', 'district', 'borough', 'locality'];
    return cityTypes.includes(geoResult.addressType.toLowerCase());
}

// ---------------------------------------------------------------------------
// Name matching helpers
// ---------------------------------------------------------------------------

/**
 * Check if artist name is an exact match (case-insensitive)
 */
export function isExactMatch(searchName, resultName) {
    return searchName.toLowerCase().trim() === resultName.toLowerCase().trim();
}

/**
 * Verify the returned artist name matches our search query
 * Uses word matching to detect wrong artists (e.g., "Keli Holiday" vs "Billie Holiday")
 */
export function verifyArtistMatch(searchName, resultName) {
    const searchLower = searchName.toLowerCase().trim();
    const resultLower = resultName.toLowerCase().trim();

    // For single-word names, require exact match to avoid "GREG" → "Greg Brown"
    const searchWords = searchLower.split(/\s+/);
    if (searchWords.length === 1) {
        return searchLower === resultLower;
    }

    // For multi-word names, allow some flexibility
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

// ---------------------------------------------------------------------------
// Country code helpers
// ---------------------------------------------------------------------------

/**
 * Extract ISO country code from a MusicBrainz area object.
 */
export function extractCountryCode(areaData) {
    if (areaData['iso-3166-1-codes']?.length > 0) {
        return areaData['iso-3166-1-codes'][0];
    }
    if (areaData['iso-3166-2-codes']?.length > 0) {
        return areaData['iso-3166-2-codes'][0].substring(0, 2);
    }
    return null;
}

/**
 * Convert ISO 3166-1 alpha-2 country code to country name
 * using the built-in Intl.DisplayNames API.
 */
export function countryCodeToName(code) {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Display name helpers
// ---------------------------------------------------------------------------

/**
 * Extract a clean "City, Country" display name from Nominatim's display_name.
 * e.g. "Osaka, Osaka Prefecture, Kinki Region, Japan" -> "Osaka, Japan"
 */
export function normalizeDisplayName(displayName) {
    const parts = displayName.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        return `${parts[0]}, ${parts[parts.length - 1]}`;
    }
    return parts[0] || displayName;
}

/**
 * Clean up Wikipedia location text (remove wiki markup)
 */
export function cleanWikipediaLocation(text) {
    return text
        .replace(/\[\[([^\|\]]+)\|?[^\]]*\]\]/g, '$1') // [[Link|Text]] -> Link
        .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch with retry logic for rate limiting (worker only - browser uses simpler fetch)
 */
export async function fetchWithRetry(url, options, maxRetries = 2) {
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

// ---------------------------------------------------------------------------
// MusicBrainz
// ---------------------------------------------------------------------------

/**
 * Fetch artist location from MusicBrainz API.
 * Returns { beginArea, beginAreaId, beginAreaType, area, areaId, areaType,
 *           mbid, artistName } or null.
 */
export async function fetchFromMusicBrainz(artistName) {
    try {
        // Use quoted search for better exact matching
        const encodedName = encodeURIComponent(`"${artistName}"`);
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
        const artists = data.artists || [];

        // Track if we found results but rejected them (vs found nothing)
        let hadCandidates = artists.length > 0;

        // Check multiple results to find the right artist
        for (const artist of artists) {
            // Verify score is high enough
            if (artist.score < 70) {
                continue;
            }

            // Verify the name actually matches (prevents "Keli Holiday" -> "Billie Holiday")
            const resultName = artist.name || '';
            const sortName = artist['sort-name'] || resultName;
            if (!verifyArtistMatch(artistName, sortName)) {
                console.log(`Name mismatch for ${artistName}: got ${sortName}, skipping`);
                continue;
            }

            console.log(`Matched ${artistName} to ${resultName} (score: ${artist.score})`);

            const beginArea = artist['begin-area']?.name || null;
            const beginAreaId = artist['begin-area']?.id || null;
            const beginAreaType = artist['begin-area']?.type || null;
            const area = artist.area?.name || null;
            const areaId = artist.area?.id || null;
            const areaType = artist.area?.type || null;
            const mbid = artist.id;

            if (beginArea || area) {
                return { beginArea, beginAreaId, beginAreaType, area, areaId, areaType, mbid, artistName: resultName };
            }

            // Exact match with no location — keep mbid for relationship following
            // but mark as exact so we don't let fallbacks find a different person
            if (isExactMatch(artistName, resultName)) {
                console.log(`Exact match for ${artistName} has no location, will try relationships only`);
                return { beginArea: null, beginAreaId: null, beginAreaType: null,
                         area: null, areaId: null, areaType: null,
                         mbid, artistName: resultName, exactMatch: true };
            }
        }

        // If we had candidates but rejected them all, signal that fallbacks are unreliable
        if (hadCandidates) {
            console.log(`No valid match for ${artistName} among ${artists.length} candidates`);
            return { noMatch: true };
        }

        return null;

    } catch (error) {
        console.error(`MusicBrainz fetch error for ${artistName}:`, error);
        return null;
    }
}

/**
 * Resolve the geographic context for an area by looking up its MusicBrainz area hierarchy.
 * Returns { country, subdivision } where subdivision is the state/province/region name.
 */
export async function resolveAreaContext(areaId, depth = 0) {
    // Limit recursion depth to prevent infinite loops
    if (depth > 5) return { country: null, subdivision: null };

    try {
        await new Promise(r => setTimeout(r, 1100));

        const response = await fetchWithRetry(
            `https://musicbrainz.org/ws/2/area/${areaId}?inc=area-rels&fmt=json`,
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response || !response.ok) return { country: null, subdivision: null };

        const data = await response.json();

        // Check the area itself for ISO codes
        let code = extractCountryCode(data);
        if (code) {
            return { country: countryCodeToName(code), subdivision: null };
        }

        // Check "part of" parent relationships
        // direction 'backward' means this area is part of rel.area (parent)
        for (const rel of (data.relations || [])) {
            if (rel.type === 'part of' && rel.direction === 'backward' && rel.area) {
                code = extractCountryCode(rel.area);
                if (code) {
                    // Parent has ISO code - it's either the country or a subdivision with country code
                    const countryName = countryCodeToName(code);
                    // If the parent is a subdivision (like Washington state with US-WA), capture it
                    const subdivision = rel.area.type === 'Subdivision' ? rel.area.name : null;
                    return { country: countryName, subdivision };
                }

                // Parent doesn't have ISO code directly - recurse up the hierarchy
                if (rel.area.id) {
                    const parentContext = await resolveAreaContext(rel.area.id, depth + 1);
                    if (parentContext.country) {
                        // If we don't have a subdivision yet, check if the immediate parent is one
                        let subdivision = parentContext.subdivision;
                        if (!subdivision && rel.area.type === 'Subdivision') {
                            subdivision = rel.area.name;
                        }
                        return { country: parentContext.country, subdivision };
                    }
                }
            }
        }

        return { country: null, subdivision: null };
    } catch (e) {
        console.warn('Area lookup error:', e);
        return { country: null, subdivision: null };
    }
}

/**
 * Resolve the country for an area (backwards-compatible wrapper).
 * Returns country name (e.g., "Japan", "United Kingdom") or null.
 */
export async function resolveAreaCountry(areaId) {
    const context = await resolveAreaContext(areaId);
    return context.country;
}

/**
 * Follow MusicBrainz "is person" relationships to find the real person
 * behind a performance name, and return their location info.
 */
export async function fetchLocationViaRelationships(mbid) {
    try {
        await new Promise(r => setTimeout(r, 1100));

        const response = await fetchWithRetry(
            `https://musicbrainz.org/ws/2/artist/${mbid}?inc=artist-rels&fmt=json`,
            {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response || !response.ok) return null;

        const data = await response.json();

        for (const rel of (data.relations || [])) {
            if (rel['type-id'] === IS_PERSON_TYPE_ID && rel.artist) {
                const personMbid = rel.artist.id;
                console.log(`Following "is person" link to ${rel.artist.name} (${personMbid})`);

                await new Promise(r => setTimeout(r, 1100));

                const personResponse = await fetchWithRetry(
                    `https://musicbrainz.org/ws/2/artist/${personMbid}?fmt=json`,
                    {
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Accept': 'application/json'
                        }
                    }
                );

                if (!personResponse || !personResponse.ok) return null;

                const person = await personResponse.json();
                const beginArea = person['begin-area']?.name || null;
                const beginAreaId = person['begin-area']?.id || null;
                const beginAreaType = person['begin-area']?.type || null;
                const area = person.area?.name || null;
                const areaId = person.area?.id || null;
                const areaType = person.area?.type || null;

                if (beginArea || area) {
                    return { beginArea, beginAreaId, beginAreaType,
                             area, areaId, areaType,
                             mbid: personMbid, artistName: person.name };
                }
            }
        }

        return null;
    } catch (e) {
        console.error('Relationship lookup error:', e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Wikipedia / Wikidata fallbacks
// ---------------------------------------------------------------------------

/**
 * Fetch artist location from Wikipedia API
 * Searches for the artist page and extracts origin/birthplace from infobox
 */
export async function fetchFromWikipedia(searchQuery) {
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
 * Fetch artist location from Wikidata SPARQL
 */
export async function fetchFromWikidata(artistName) {
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
 * Look up the capital city of a subdivision via Wikidata SPARQL.
 * e.g. "Western Australia" → "Perth", "New South Wales" → "Sydney"
 */
export async function fetchSubdivisionCapital(subdivisionName) {
    try {
        const sparql = `
            SELECT ?capitalLabel WHERE {
                ?place rdfs:label "${subdivisionName.replace(/"/g, '\\"')}"@en .
                ?place wdt:P36 ?capital .
                SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
            } LIMIT 1
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

        if (!response.ok) return null;
        const data = await response.json();
        if (data.results?.bindings?.length > 0) {
            return data.results.bindings[0].capitalLabel?.value;
        }
        return null;
    } catch (e) {
        console.warn('Subdivision capital lookup error:', e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

/**
 * Geocode a location name to coordinates.
 * Returns { coords: [lat, lon], displayName: "City, Country", addressType } or null.
 * Tries Nominatim first, falls back to Photon (both free, OSM-based).
 */
export async function geocodeLocation(locationName) {
    // Try Nominatim first
    let result = await geocodeWithNominatim(locationName);
    if (result) return result;

    // Fallback to Photon (no display_name, so we keep the original)
    let coords = await geocodeWithPhoton(locationName);
    if (coords) return { coords, displayName: locationName };

    // Try simplified location (just country)
    if (locationName.includes(',')) {
        const parts = locationName.split(',');
        const country = parts[parts.length - 1].trim();
        result = await geocodeWithNominatim(country);
        if (result) return result;
        coords = await geocodeWithPhoton(country);
        if (coords) return { coords, displayName: country };
    }

    return null;
}

/**
 * Geocode using Nominatim (OpenStreetMap)
 */
export async function geocodeWithNominatim(query) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=en`,
            { headers: { 'User-Agent': USER_AGENT } }
        );
        if (!response.ok) return null;
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                coords: [parseFloat(data[0].lat), parseFloat(data[0].lon)],
                displayName: normalizeDisplayName(data[0].display_name),
                addressType: data[0].addresstype || data[0].type
            };
        }
    } catch (e) {
        console.warn('Nominatim error:', e.message);
    }
    return null;
}

/**
 * Geocode using Photon (Komoot's geocoding service)
 */
export async function geocodeWithPhoton(query) {
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

/**
 * Geocode a chosen area (from chooseBestArea) with country/subdivision context.
 * For subdivisions (e.g. "Western Australia"), snaps to the capital city.
 * Returns { coords, displayName } or null.
 */
export async function geocodeMusicBrainzResult(bestArea) {
    const context = bestArea.id ? await resolveAreaContext(bestArea.id) : { country: null, subdivision: null };
    const { country, subdivision } = context;

    // For subdivisions, snap to the capital city (avoids geocoding to the
    // geographic centre of huge regions like Western Australia)
    if (bestArea.type?.toLowerCase() === 'subdivision') {
        const capital = await fetchSubdivisionCapital(bestArea.name);
        if (capital) {
            const query = country ? `${capital}, ${country}` : capital;
            const geoResult = await geocodeLocation(query);
            if (geoResult) return geoResult;
        }
    }

    // Geocode with full context (subdivision + country) for disambiguation
    if (subdivision && country) {
        const geoResult = await geocodeLocation(`${bestArea.name}, ${subdivision}, ${country}`);
        if (geoResult) return geoResult;
    }

    // Try with just subdivision (state)
    if (subdivision) {
        const geoResult = await geocodeLocation(`${bestArea.name}, ${subdivision}`);
        if (geoResult) return geoResult;
    }

    // Geocode with country context
    if (country) {
        const geoResult = await geocodeLocation(`${bestArea.name}, ${country}`);
        if (geoResult) return geoResult;
    }

    // Try without country
    const geoResult = await geocodeLocation(bestArea.name);
    if (geoResult) return geoResult;

    return null;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Resolve an artist's location using all available sources.
 * Returns { location_name, location_coord } where location_coord is [lat, lon] or null.
 *
 * Resolution order:
 * 1. MusicBrainz begin-area/area (if city-level)
 * 2. MusicBrainz "is person" relationships
 * 3. Wikidata P19/P740
 * 4. Wikipedia infobox scraping
 * 5. MusicBrainz area (with subdivision capital snap)
 */
export async function resolveArtistLocation(artistName) {
    let mbResult = await fetchFromMusicBrainz(artistName);

    // If MusicBrainz had candidates but we rejected them all, don't trust fallbacks
    if (mbResult?.noMatch) {
        console.log(`Rejected all MusicBrainz candidates for ${artistName}, returning Unknown`);
        return { location_name: 'Unknown', location_coord: null };
    }

    let bestArea = (mbResult && (mbResult.beginArea || mbResult.area))
        ? chooseBestArea(mbResult) : null;

    let result;

    if (bestArea && isCityLevel(bestArea.type)) {
        // City-level area — geocode directly with country resolution
        const geoResult = await geocodeMusicBrainzResult(bestArea);
        result = {
            location_name: geoResult ? geoResult.displayName : bestArea.name,
            location_coord: geoResult ? geoResult.coords : null
        };
    } else {
        // Not specific enough — try to enhance

        // 4a. Try "is person" relationships (e.g. Keli Holiday → Adam Hyde)
        if (mbResult && mbResult.mbid) {
            const personResult = await fetchLocationViaRelationships(mbResult.mbid);
            if (personResult) {
                mbResult = personResult;
                bestArea = chooseBestArea(mbResult);
            }
        }

        // 4b. If relationships gave us city-level data, use it
        if (bestArea && isCityLevel(bestArea.type)) {
            const geoResult = await geocodeMusicBrainzResult(bestArea);
            result = {
                location_name: geoResult ? geoResult.displayName : bestArea.name,
                location_coord: geoResult ? geoResult.coords : null
            };
        } else if (mbResult?.exactMatch && !bestArea) {
            // 4b-alt. Exact match in MusicBrainz but no location data
            // Don't try fallbacks - they might find a different person with same name
            console.log(`Exact match for ${artistName} has no location, returning Unknown`);
            result = {
                location_name: 'Unknown',
                location_coord: null
            };
        } else {
            // 4c. Try Wikidata P19/P740 for artist directly
            let wikidataLocation = await fetchFromWikidata(artistName);

            if (wikidataLocation) {
                // 4d. Wikidata returned something — geocode it
                const geoResult = await geocodeLocation(wikidataLocation);
                result = {
                    location_name: geoResult ? geoResult.displayName : wikidataLocation,
                    location_coord: geoResult ? geoResult.coords : null
                };
            } else {
                // 4e. Try Wikipedia infobox scraping
                let wikiLocation = null;
                wikiLocation = await fetchFromWikipedia(artistName + ' musician');
                if (!wikiLocation) wikiLocation = await fetchFromWikipedia(artistName + ' band');
                if (!wikiLocation) wikiLocation = await fetchFromWikipedia(artistName);

                if (wikiLocation) {
                    // 4f. Wikipedia returned something
                    // 4f-i. Try geocoding it directly first
                    let geoResult = await geocodeLocation(wikiLocation);

                    // 4f-ii/iii. Check if result is city-level or if we need to snap to capital
                    if (geoResult && !isCityLevelGeocode(geoResult)) {
                        // Result is subdivision/region — try capital snap
                        const locationParts = wikiLocation.split(',').map(p => p.trim());
                        const subdivisionName = locationParts[0];
                        const capital = await fetchSubdivisionCapital(subdivisionName);
                        if (capital) {
                            const capitalResult = await geocodeLocation(`${capital}, ${wikiLocation}`);
                            if (capitalResult) geoResult = capitalResult;
                        }
                    } else if (!geoResult) {
                        // 4f-iv. Geocode failed — try capital snap
                        const locationParts = wikiLocation.split(',').map(p => p.trim());
                        const subdivisionName = locationParts[0];
                        const capital = await fetchSubdivisionCapital(subdivisionName);
                        if (capital) {
                            geoResult = await geocodeLocation(`${capital}, ${wikiLocation}`);
                        }
                    }

                    result = {
                        location_name: geoResult ? geoResult.displayName : wikiLocation,
                        location_coord: geoResult ? geoResult.coords : null
                    };
                } else if (bestArea) {
                    // 4g. Fall back to MusicBrainz area (with subdivision capital snap)
                    const geoResult = await geocodeMusicBrainzResult(bestArea);
                    result = {
                        location_name: geoResult ? geoResult.displayName : bestArea.name,
                        location_coord: geoResult ? geoResult.coords : null
                    };
                } else {
                    // 5. Nothing worked
                    result = {
                        location_name: 'Unknown',
                        location_coord: null
                    };
                }
            }
        }
    }

    return result;
}
