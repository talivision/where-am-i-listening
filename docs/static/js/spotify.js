/**
 * Spotify API Client
 * Handles fetching user's top artists from Spotify
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Fetch user's top artists from Spotify
 * @param {string} token - Spotify access token
 * @param {number} limit - Number of artists to fetch (max 50)
 * @param {string} timeRange - Time range: short_term, medium_term, long_term
 * @returns {Promise<Array>} Array of artist objects
 */
export async function fetchTopArtists(token, limit = 50, timeRange = 'medium_term') {
    const response = await fetch(
        `${SPOTIFY_API_BASE}/me/top/artists?limit=${limit}&time_range=${timeRange}`,
        {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }
    );

    if (!response.ok) {
        if (response.status === 401) {
            // Token expired, try to refresh
            const newToken = await window.SpotifyAuth.refreshToken();
            return fetchTopArtists(newToken, limit, timeRange);
        }
        throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();
    return data.items;
}

/**
 * Get user profile information
 * @param {string} token - Spotify access token
 * @returns {Promise<Object>} User profile object
 */
export async function fetchUserProfile(token) {
    const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    return response.json();
}

/**
 * Extract relevant artist data for the globe visualization
 * @param {Array} artists - Array of Spotify artist objects
 * @returns {Array} Simplified artist data
 */
export function extractArtistData(artists) {
    return artists.map(artist => ({
        id: artist.id,
        name: artist.name,
        popularity: artist.popularity,
        genres: artist.genres,
        image: artist.images?.[0]?.url || null,
        spotifyUrl: artist.external_urls?.spotify || null
    }));
}

// Export for use in inline scripts via window
window.SpotifyAPI = {
    fetchTopArtists,
    fetchUserProfile,
    extractArtistData
};
