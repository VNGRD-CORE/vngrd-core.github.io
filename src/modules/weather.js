// ═══════════════════════════════════════════════════════════════
// WEATHER / ATMOSPHERE MODULE — Geolocation + Open-Meteo
// Extracted from main.js (was inside DOMContentLoaded).
// Depends on: $, APP, log, updateTickerCycle (globals from main.js/ticker.js)
// ═══════════════════════════════════════════════════════════════

// GEO_HANDSHAKE: Get real coordinates
async function initAtmosphere() {
    log('GEO_HANDSHAKE: ACQUIRING...');
    const geoStatus = $('geo-status');
    if (geoStatus) geoStatus.textContent = 'GEO: ACQUIRING...';

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            log('GEO: NOT_SUPPORTED');
            resolve(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                APP.atmosphere.latitude = position.coords.latitude;
                APP.atmosphere.longitude = position.coords.longitude;
                log(`GPS_LOCKED: ${APP.atmosphere.latitude.toFixed(2)}`);
                await fetchSatelliteWeather();
                resolve(true);
            },
            async (error) => {
                log('GPS_DENIED: FALLBACK_ENGAGED');
                try {
                    const res = await fetch('https://ipapi.co/json/');
                    const data = await res.json();
                    APP.atmosphere.latitude = data.latitude;
                    APP.atmosphere.longitude = data.longitude;
                    APP.atmosphere.city = data.city.toUpperCase();
                    await fetchSatelliteWeather();
                } catch (e) {
                    APP.atmosphere.latitude = 52.52;
                    APP.atmosphere.longitude = 13.41;
                    await fetchSatelliteWeather();
                }
                resolve(false);
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    });
}

// Fetch weather from Open-Meteo with reverse geocoding
async function fetchSatelliteWeather() {
    try {
        const lat = APP.atmosphere.latitude || 52.52;
        const lon = APP.atmosphere.longitude || 13.41;

        const weatherResp = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=weathercode`
        );
        const weather = await weatherResp.json();

        const temp = weather.current_weather.temperature;
        const weatherCode = weather.current_weather.weathercode;
        const windSpeed = weather.current_weather.windspeed;

        APP.atmosphere.temperature = temp;
        APP.atmosphere.weatherCode = weatherCode;

        const weatherMap = {
            0: 'CLEAR', 1: 'MAINLY_CLEAR', 2: 'PARTLY_CLOUDY', 3: 'OVERCAST',
            45: 'FOG', 48: 'RIME_FOG',
            51: 'LIGHT_DRIZZLE', 53: 'DRIZZLE', 55: 'DENSE_DRIZZLE',
            61: 'LIGHT_RAIN', 63: 'RAIN', 65: 'HEAVY_RAIN',
            71: 'LIGHT_SNOW', 73: 'SNOW', 75: 'HEAVY_SNOW',
            80: 'LIGHT_SHOWERS', 81: 'SHOWERS', 82: 'VIOLENT_SHOWERS',
            95: 'THUNDERSTORM', 96: 'HAIL_STORM', 99: 'HEAVY_HAIL'
        };

        const condition = weatherMap[weatherCode] || 'UNKNOWN';
        APP.atmosphere.metar = `${temp}C // ${condition} // ${windSpeed}KMH`;

        APP.atmosphere.isRaining = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(weatherCode);

        // Reverse geocoding for city name
        try {
            const geoResp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
            );
            const geo = await geoResp.json();
            APP.atmosphere.city = (geo.address?.city || geo.address?.town || geo.address?.village || 'UNKNOWN').toUpperCase();
            APP.atmosphere.country = (geo.address?.country_code || '').toUpperCase();
        } catch (e) {
            APP.atmosphere.city = 'UNKNOWN';
        }

        const geoStatus = $('geo-status');
        if (geoStatus) geoStatus.textContent = `GEO: ${APP.atmosphere.city} [${APP.atmosphere.country}]`;

        updateTickerWithMetar();
        updateWeatherUI(condition, APP.atmosphere.isRaining);

        log(`SATELLITE: [${APP.atmosphere.city}] ${APP.atmosphere.metar}`);

    } catch (e) {
        log('SATELLITE_ERROR: ' + e.message);
        const weatherStatus = $('weather-status');
        if (weatherStatus) weatherStatus.textContent = 'WEATHER: ERROR';
    }
}

// Update ticker with fresh weather data (feeds into cycle engine)
function updateTickerWithMetar() {
    updateTickerCycle();
    if (APP.atmosphere.city) log(`REAL_TIME_SYNC: ${APP.atmosphere.city} @ ${APP.atmosphere.temperature}°C`);
}

// Update weather UI status displays (data only, no FX)
function updateWeatherUI(condition, isRaining) {
    const weatherStatus = $('weather-status');
    const atmosDot = $('atmos-dot');
    if (weatherStatus) weatherStatus.textContent = 'WEATHER: ' + condition.toUpperCase();
    if (atmosDot) atmosDot.classList.toggle('off', !isRaining);
    if ($('weather-fx')) $('weather-fx').textContent = isRaining ? 'RAIN_DETECTED (DATA ONLY)' : 'CLEAR (DATA ONLY)';
}

// Initialize satellite atmosphere on load (10-minute polling)
initAtmosphere();
setInterval(fetchSatelliteWeather, 600000);
