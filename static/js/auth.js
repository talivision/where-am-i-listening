/**
 * Spotify PKCE OAuth Authentication
 * Implements the Authorization Code with PKCE flow for Spotify API
 */

const AUTH_CONFIG = {
    clientId: '931a74d0cca34381b65899b69835b8a0',
    scopes: ['user-top-read', 'user-library-read'],
    // Spotify requires HTTPS except for loopback IPs (127.0.0.1, [::1])
    // localhost is NOT allowed - must use 127.0.0.1
    redirectUri: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? `http://127.0.0.1:${window.location.port}/callback.html`
        : window.location.origin + '/callback.html'
};

/**
 * Generate a random string for PKCE code verifier
 */
function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values).map(x => possible[x % possible.length]).join('');
}

/**
 * Generate SHA-256 hash of the code verifier
 */
async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

/**
 * Base64url encode the hash for code challenge
 */
function base64urlencode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let str = '';
    bytes.forEach(byte => str += String.fromCharCode(byte));
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Generate PKCE code challenge from verifier
 */
async function generateCodeChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64urlencode(hashed);
}

/**
 * Initiate Spotify login with PKCE
 */
async function login() {
    // Generate and store code verifier
    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);

    // Generate code challenge
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Generate state for CSRF protection
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    // Build authorization URL
    const params = new URLSearchParams({
        client_id: AUTH_CONFIG.clientId,
        response_type: 'code',
        redirect_uri: AUTH_CONFIG.redirectUri,
        scope: AUTH_CONFIG.scopes.join(' '),
        state: state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Handle OAuth callback - exchange code for token
 */
async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    // Check for errors
    if (error) {
        throw new Error(`OAuth error: ${error}`);
    }

    // Verify state
    const storedState = sessionStorage.getItem('oauth_state');
    if (state !== storedState) {
        throw new Error('State mismatch - possible CSRF attack');
    }

    // Get code verifier
    const codeVerifier = sessionStorage.getItem('code_verifier');
    if (!codeVerifier) {
        throw new Error('No code verifier found');
    }

    // Exchange code for token
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: AUTH_CONFIG.clientId,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: AUTH_CONFIG.redirectUri,
            code_verifier: codeVerifier
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Token exchange failed: ${errorData.error_description || errorData.error}`);
    }

    const tokenData = await response.json();

    // Store tokens
    sessionStorage.setItem('access_token', tokenData.access_token);
    sessionStorage.setItem('refresh_token', tokenData.refresh_token);
    sessionStorage.setItem('token_expiry', Date.now() + (tokenData.expires_in * 1000));

    // Clean up
    sessionStorage.removeItem('code_verifier');
    sessionStorage.removeItem('oauth_state');

    return tokenData.access_token;
}

/**
 * Refresh the access token
 */
async function refreshToken() {
    const refreshToken = sessionStorage.getItem('refresh_token');
    if (!refreshToken) {
        throw new Error('No refresh token available');
    }

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: AUTH_CONFIG.clientId,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        // Refresh failed, need to re-login
        logout();
        throw new Error('Token refresh failed');
    }

    const tokenData = await response.json();

    sessionStorage.setItem('access_token', tokenData.access_token);
    sessionStorage.setItem('token_expiry', Date.now() + (tokenData.expires_in * 1000));

    if (tokenData.refresh_token) {
        sessionStorage.setItem('refresh_token', tokenData.refresh_token);
    }

    return tokenData.access_token;
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidToken() {
    const token = sessionStorage.getItem('access_token');
    const expiry = sessionStorage.getItem('token_expiry');

    if (!token) {
        return null;
    }

    // Refresh if token expires in less than 5 minutes
    if (expiry && Date.now() > (parseInt(expiry) - 300000)) {
        return await refreshToken();
    }

    return token;
}

/**
 * Check if user is logged in
 */
function isLoggedIn() {
    return sessionStorage.getItem('access_token') !== null;
}

/**
 * Logout - clear all stored tokens
 */
function logout() {
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('token_expiry');
    sessionStorage.removeItem('code_verifier');
    sessionStorage.removeItem('oauth_state');
}

// Export for use in other modules
window.SpotifyAuth = {
    login,
    handleCallback,
    getValidToken,
    isLoggedIn,
    logout,
    refreshToken
};
