/**
 * Globe.gl Visualization
 * Renders artist locations on a 3D globe with floating pin markers
 */

let globe = null;
let autoRotate = true;
let rotationTimeout = null;

// Color scale based on artist popularity
function getMarkerColor(popularity) {
    // Spotify popularity is 0-100
    if (popularity >= 80) return '#1DB954'; // Spotify green - very popular
    if (popularity >= 60) return '#1ed760'; // Light green
    if (popularity >= 40) return '#ffc107'; // Yellow
    if (popularity >= 20) return '#ff9800'; // Orange
    return '#ff5722'; // Red-orange - less known
}

// Size based on popularity
function getMarkerSize(popularity) {
    return 0.4 + (popularity / 100) * 0.4; // 0.4 to 0.8
}

/**
 * Group artists by location and stack vertically
 * Artists within ~50km of each other are considered same location
 */
function processArtistsForDisplay(artists) {
    const PROXIMITY_THRESHOLD = 0.5; // ~50km in degrees
    const BASE_ALTITUDE = 0.06; // Base floating height
    const STACK_INCREMENT = 0.04; // Height between stacked markers

    // Group artists by proximity
    const groups = [];
    const processed = new Set();

    artists.forEach((artist, i) => {
        if (processed.has(i)) return;

        const group = [artist];
        processed.add(i);

        // Find nearby artists
        artists.forEach((other, j) => {
            if (processed.has(j)) return;
            const latDiff = Math.abs(artist.location_coord[0] - other.location_coord[0]);
            const lngDiff = Math.abs(artist.location_coord[1] - other.location_coord[1]);
            if (latDiff < PROXIMITY_THRESHOLD && lngDiff < PROXIMITY_THRESHOLD) {
                group.push(other);
                processed.add(j);
            }
        });

        groups.push(group);
    });

    // Assign altitudes for stacking
    const result = [];
    groups.forEach(group => {
        // Sort by popularity (most popular at top)
        group.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        group.forEach((artist, stackIndex) => {
            result.push({
                ...artist,
                lat: artist.location_coord[0],
                lng: artist.location_coord[1],
                altitude: BASE_ALTITUDE + (stackIndex * STACK_INCREMENT),
                stackIndex,
                groupSize: group.length
            });
        });
    });

    return result;
}

/**
 * Initialize the globe visualization
 * @param {HTMLElement} container - DOM element to render the globe in
 * @param {Array} artists - Array of artist objects with location data
 */
function initGlobe(container, artists) {
    // Filter artists with valid coordinates
    const validArtists = artists.filter(a =>
        a.location_coord &&
        Array.isArray(a.location_coord) &&
        a.location_coord.length === 2 &&
        a.location_coord[0] !== 0 &&
        a.location_coord[1] !== 0
    );

    // Process for stacking overlapping markers
    const processedArtists = processArtistsForDisplay(validArtists);

    // Create ring data for ground markers (shows where pins connect to surface)
    const ringData = processedArtists.filter(a => a.stackIndex === 0).map(a => ({
        lat: a.lat,
        lng: a.lng,
        color: getMarkerColor(a.popularity)
    }));

    // Create the globe
    globe = Globe()
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .showAtmosphere(true)
        .atmosphereColor('#3a228a')
        .atmosphereAltitude(0.25)

        // Rings at base of pins (ground markers)
        .ringsData(ringData)
        .ringLat('lat')
        .ringLng('lng')
        .ringColor('color')
        .ringMaxRadius(0.8)
        .ringPropagationSpeed(0)
        .ringRepeatPeriod(0)
        .ringAltitude(0.001)

        // Floating point markers
        .pointsData(processedArtists)
        .pointLat('lat')
        .pointLng('lng')
        .pointAltitude('altitude')
        .pointRadius(d => getMarkerSize(d.popularity))
        .pointColor(d => getMarkerColor(d.popularity))
        .pointLabel(d => createTooltip(d))
        .onPointClick(handleArtistClick)
        .onPointHover(handleArtistHover)

        // Labels float above the points
        .labelsData(processedArtists)
        .labelLat('lat')
        .labelLng('lng')
        .labelText('name')
        .labelSize(0.4)
        .labelDotRadius(0)
        .labelColor(() => 'rgba(255, 255, 255, 0.9)')
        .labelResolution(2)
        .labelAltitude(d => d.altitude + 0.02)
        (container);

    // Set initial view
    globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });

    // Auto-rotation
    startAutoRotate();

    // Pause rotation on interaction
    container.addEventListener('mousedown', pauseAutoRotate);
    container.addEventListener('touchstart', pauseAutoRotate);
    container.addEventListener('wheel', pauseAutoRotate);

    // Handle window resize
    window.addEventListener('resize', () => {
        globe.width(container.clientWidth);
        globe.height(container.clientHeight);
    });

    return globe;
}

/**
 * Create tooltip HTML for an artist
 */
function createTooltip(artist) {
    const stackInfo = artist.groupSize > 1
        ? `<span class="stack-info">${artist.groupSize} artists from this area</span>`
        : '';
    return `
        <div class="artist-tooltip">
            ${artist.image ? `<img src="${artist.image}" alt="${artist.name}" />` : ''}
            <div class="tooltip-content">
                <strong>${artist.name}</strong>
                <span class="location">${artist.location_name || 'Unknown location'}</span>
                <span class="popularity">Popularity: ${artist.popularity}/100</span>
                ${artist.genres?.length ? `<span class="genres">${artist.genres.slice(0, 3).join(', ')}</span>` : ''}
                ${stackInfo}
            </div>
        </div>
    `;
}

/**
 * Handle click on an artist marker
 */
function handleArtistClick(artist) {
    if (artist && artist.spotifyUrl) {
        window.open(artist.spotifyUrl, '_blank');
    }
}

/**
 * Handle hover on an artist marker
 */
function handleArtistHover(artist) {
    document.body.style.cursor = artist ? 'pointer' : 'default';
}

/**
 * Start auto-rotation of the globe
 */
function startAutoRotate() {
    autoRotate = true;

    function rotate() {
        if (!autoRotate || !globe) return;

        const currentPov = globe.pointOfView();
        globe.pointOfView({
            lat: currentPov.lat,
            lng: currentPov.lng + 0.1,
            altitude: currentPov.altitude
        });

        requestAnimationFrame(rotate);
    }

    rotate();
}

/**
 * Pause auto-rotation temporarily
 */
function pauseAutoRotate() {
    autoRotate = false;

    // Resume after 3 seconds of inactivity
    if (rotationTimeout) {
        clearTimeout(rotationTimeout);
    }
    rotationTimeout = setTimeout(() => {
        autoRotate = true;
        startAutoRotate();
    }, 3000);
}

/**
 * Fly to a specific artist's location
 */
function flyToArtist(artist) {
    if (!globe || !artist.location_coord) return;

    pauseAutoRotate();

    globe.pointOfView({
        lat: artist.location_coord[0],
        lng: artist.location_coord[1],
        altitude: 1.5
    }, 1000); // 1 second animation
}

/**
 * Update globe with new artist data
 */
function updateGlobeData(artists) {
    if (!globe) return;

    const validArtists = artists.filter(a =>
        a.location_coord &&
        a.location_coord[0] !== 0 &&
        a.location_coord[1] !== 0
    );

    const processedArtists = processArtistsForDisplay(validArtists);

    const ringData = processedArtists.filter(a => a.stackIndex === 0).map(a => ({
        lat: a.lat,
        lng: a.lng,
        color: getMarkerColor(a.popularity)
    }));

    globe.ringsData(ringData);
    globe.pointsData(processedArtists);
    globe.labelsData(processedArtists);
}

/**
 * Set globe theme (dark/light)
 */
function setGlobeTheme(theme) {
    if (!globe) return;

    if (theme === 'dark') {
        globe.globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg');
        globe.backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png');
    } else {
        globe.globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
        globe.backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png');
    }
}

/**
 * Destroy the globe instance
 */
function destroyGlobe() {
    if (globe) {
        globe._destructor && globe._destructor();
        globe = null;
    }
    autoRotate = false;
    if (rotationTimeout) {
        clearTimeout(rotationTimeout);
    }
}

// Export for use in other modules
window.GlobeViz = {
    initGlobe,
    flyToArtist,
    updateGlobeData,
    setGlobeTheme,
    destroyGlobe,
    pauseAutoRotate,
    startAutoRotate
};
