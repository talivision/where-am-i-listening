/**
 * Globe.gl Visualization
 * Renders artist locations on a 3D globe with aggregated location markers
 */

let globe = null;
let autoRotate = true;
let rotationTimeout = null;

/**
 * Color based on artist count at location
 * Red -> Yellow -> Green ramp
 */
function getLocationColor(count, maxCount) {
    const ratio = 1 - Math.min((count - 1) / Math.max(maxCount - 1, 1), 1);

    // Red (#e53935) -> Yellow (#fdd835) -> Green (#43a047)
    if (ratio < 0.5) {
        const t = ratio * 2;
        const r = Math.round(229 + (253 - 229) * t);
        const g = Math.round(57 + (216 - 57) * t);
        const b = Math.round(53 + (53 - 53) * t);
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        const t = (ratio - 0.5) * 2;
        const r = Math.round(253 - (253 - 67) * t);
        const g = Math.round(216 - (216 - 160) * t);
        const b = Math.round(53 + (71 - 53) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }
}

/**
 * Group artists by location into aggregated markers
 */
function aggregateArtistsByLocation(artists) {
    const PROXIMITY_THRESHOLD = 0.5; // ~50km in degrees

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

    // Find max count for color scaling
    const maxCount = Math.max(...groups.map(g => g.length));

    // Create aggregated location data
    return groups.map(group => {
        // Sort by popularity
        group.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        // Use first artist's coords (they're all close anyway)
        const lat = group[0].location_coord[0];
        const lng = group[0].location_coord[1];

        return {
            lat,
            lng,
            artists: group,
            count: group.length,
            maxCount,
            // Use most common location name, or first one
            locationName: group[0].location_name || 'Unknown',
            // Average popularity for reference
            avgPopularity: group.reduce((sum, a) => sum + (a.popularity || 0), 0) / group.length
        };
    });
}

/**
 * Initialize the globe visualization
 */
export function initGlobe(container, artists) {
    // Filter artists with valid coordinates
    const validArtists = artists.filter(a =>
        a.location_coord &&
        Array.isArray(a.location_coord) &&
        a.location_coord.length === 2 &&
        a.location_coord[0] !== 0 &&
        a.location_coord[1] !== 0
    );

    // Aggregate by location
    const locations = aggregateArtistsByLocation(validArtists);

    // Create the globe
    globe = Globe()
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
        .showAtmosphere(true)
        .atmosphereColor('#3a228a')
        .atmosphereAltitude(0.25)

        // HTML badge markers (2D, always face camera)
        .htmlElementsData(locations)
        .htmlLat('lat')
        .htmlLng('lng')
        .htmlAltitude(0.01)
        .htmlElement(d => createBadgeMarker(d))
        (container);

    // Set initial view
    globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });

    // Auto-rotation
    startAutoRotate();

    // Stop rotation permanently on click
    container.addEventListener('mousedown', stopAutoRotate);
    container.addEventListener('touchstart', stopAutoRotate);

    // Handle window resize
    window.addEventListener('resize', () => {
        globe.width(container.clientWidth);
        globe.height(container.clientHeight);
    });

    return globe;
}

/**
 * Create HTML badge marker (pin with number)
 */
function createBadgeMarker(location) {
    const el = document.createElement('div');
    el.className = 'globe-badge';
    el.style.pointerEvents = 'auto';

    // Pass wheel events through to the globe canvas for zooming
    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Find the globe canvas and dispatch the wheel event to it
        const canvas = document.querySelector('#globe-container canvas');
        if (canvas) {
            canvas.dispatchEvent(new WheelEvent('wheel', {
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaZ: e.deltaZ,
                deltaMode: e.deltaMode,
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
                metaKey: e.metaKey,
                bubbles: true
            }));
        }
    }, { passive: false });

    const color = getLocationColor(location.count, location.maxCount);

    // Build artist list HTML for tooltip (always show location as subtitle)
    const artistListHtml = location.artists.map(a => `
        <div class="tooltip-artist">
            ${a.image ? `<img src="${a.image}" alt="${a.name}" />` : '<div class="no-img"></div>'}
            <div class="tooltip-artist-info">
                <span class="name">${a.name}</span>
                <span class="location">${a.location_name || 'Unknown'}</span>
            </div>
        </div>
    `).join('');

    // Build tooltip header
    const headerHtml = `<span class="artist-count">${location.count} artist${location.count > 1 ? 's' : ''}</span>`;

    // Create the badge structure with embedded tooltip
    el.innerHTML = `
        <div class="badge-pin" style="background: ${color}; border-color: ${color};">
            <span class="badge-count">${location.count}</span>
        </div>
        <div class="badge-label">${truncateNames(location.artists)}</div>
        <div class="badge-tooltip" popover>
            <div class="tooltip-header">
                ${headerHtml}
            </div>
            <div class="tooltip-artists">
                ${artistListHtml}
            </div>
        </div>
    `;

    // Get tooltip element
    const tooltip = el.querySelector('.badge-tooltip');

    // Position tooltip on mouse move
    el.addEventListener('mousemove', (e) => {
        if (tooltip) {
            tooltip.style.left = (e.clientX + 8) + 'px';
            tooltip.style.top = (e.clientY + 8) + 'px';
        }
    });

    // Show/hide tooltip on hover
    el.addEventListener('mouseenter', (e) => {
        if (tooltip) {
            tooltip.style.left = (e.clientX + 8) + 'px';
            tooltip.style.top = (e.clientY + 8) + 'px';
            tooltip.showPopover();
            tooltip.style.opacity = '1';
            tooltip.style.visibility = 'visible';
        }
    });

    el.addEventListener('mouseleave', () => {
        if (tooltip) {
            tooltip.style.opacity = '0';
            tooltip.style.visibility = 'hidden';
        }
    });

    // Add click handler - open modal with artist list
    el.addEventListener('click', () => {
        if (window.openArtistModal) {
            window.openArtistModal(location.artists);
        }
    });

    return el;
}

/**
 * Truncate artist names for label
 */
function truncateNames(artists) {
    const names = artists.map(a => a.name);
    if (names.length === 1) {
        return names[0];
    } else if (names.length === 2) {
        return names.join(', ');
    } else {
        return `${names[0]}, ${names[1]} +${names.length - 2}`;
    }
}

/**
 * Start auto-rotation of the globe
 */
export function startAutoRotate() {
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
 * Stop auto-rotation permanently
 */
export function stopAutoRotate() {
    autoRotate = false;
    if (rotationTimeout) {
        clearTimeout(rotationTimeout);
        rotationTimeout = null;
    }
}

/**
 * Fly to a specific artist's location
 */
export function flyToArtist(artist) {
    if (!globe || !artist.location_coord) return;

    stopAutoRotate();

    globe.pointOfView({
        lat: artist.location_coord[0],
        lng: artist.location_coord[1],
        altitude: 1.5
    }, 1000);
}

/**
 * Update globe with new artist data
 */
export function updateGlobeData(artists) {
    if (!globe) return;

    const validArtists = artists.filter(a =>
        a.location_coord &&
        a.location_coord[0] !== 0 &&
        a.location_coord[1] !== 0
    );

    const locations = aggregateArtistsByLocation(validArtists);

    globe.htmlElementsData(locations);
}

/**
 * Set globe theme (dark/light)
 */
export function setGlobeTheme(theme) {
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
export function destroyGlobe() {
    if (globe) {
        globe._destructor && globe._destructor();
        globe = null;
    }
    autoRotate = false;
    if (rotationTimeout) {
        clearTimeout(rotationTimeout);
    }
}

// Export for use in inline scripts via window
window.GlobeViz = {
    initGlobe,
    flyToArtist,
    updateGlobeData,
    setGlobeTheme,
    destroyGlobe,
    stopAutoRotate,
    startAutoRotate
};
