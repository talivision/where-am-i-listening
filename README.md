# Where Am I Listening?

Visualize where your Spotify top artists come from on a 3D globe.

## Features

- PKCE OAuth authentication (secure, no client secret needed)
- Interactive 3D globe powered by Globe.gl
- Artist location lookup via MusicBrainz and Wikidata
- Color-coded markers by artist popularity
- Click to fly to artist locations
- Dark/light globe themes

## Architecture

```
static/                    # Static site (GitHub Pages)
├── index.html          # Landing page with Spotify login
├── callback.html       # OAuth callback handler
├── globe.html          # Main globe visualization
├── js/
│   ├── auth.js         # PKCE OAuth flow
│   ├── spotify.js      # Spotify API client
│   ├── api.js          # Worker API client
│   └── globe.js        # Globe.gl visualization
└── css/
    └── styles.css

worker/                  # Cloudflare Worker (optional backend)
├── src/index.js        # Worker code
├── wrangler.toml       # Cloudflare config
└── package.json
```

## Local Development

### Prerequisites

- Node.js 18+
- A Spotify Developer account

### Setup

1. **Register your app with Spotify:**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create an app or use the existing one
   - Add `http://127.0.0.1:8080/callback.html` to Redirect URIs
   - Note: Spotify allows HTTP only for loopback IPs (127.0.0.1), not localhost

2. **Update the client ID** (if different):
   - Edit `static/js/auth.js` and update `AUTH_CONFIG.clientId`

3. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```

4. **Open http://127.0.0.1:8080** (must use 127.0.0.1, not localhost)

### Testing the Worker locally

```bash
cd worker
npm install
npm run dev
```

The worker will run at `http://localhost:8787`. Update the API URL in the browser console:
```javascript
window.LocationAPI.setApiBaseUrl('http://localhost:8787')
```

## Deployment

### GitHub Pages (Frontend)

1. Rename `static/` to `docs/` or use GitHub Actions
2. Go to repository Settings > Pages
3. Set source to "Deploy from a branch"
4. Select `master` branch and `/docs` folder (or root if using Actions)
5. Add your GitHub Pages URL to Spotify redirect URIs (must be HTTPS)

### Cloudflare Workers (Backend)

1. Install Wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Create KV namespace:
   ```bash
   cd worker
   wrangler kv:namespace create "ARTIST_CACHE"
   ```
4. Update `wrangler.toml` with the namespace ID
5. Deploy: `npm run deploy:worker`
6. Update `static/js/api.js` with your worker URL

### Pure Static Mode

The app works without the Cloudflare Worker by calling MusicBrainz/Wikidata directly from the browser. This is slower due to rate limits (1 request/second) but requires no backend.

## Configuration

### Spotify Client ID

Edit `static/js/auth.js`:
```javascript
const AUTH_CONFIG = {
    clientId: 'YOUR_SPOTIFY_CLIENT_ID',
    ...
};
```

### Worker URL

Edit `static/js/api.js` or set at runtime:
```javascript
window.LocationAPI.setApiBaseUrl('https://your-worker.workers.dev')
```

## License

MIT
