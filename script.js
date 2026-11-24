// ========================================
// RIVERWATCH — LIVE DATE AND TIME
// ========================================

function updateClock() {

    const now = new Date();

    const date = now.toLocaleDateString("en-IE", {
        timeZone: "Europe/Dublin",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    const time = now.toLocaleTimeString("en-IE", {
        timeZone: "Europe/Dublin",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });

    document.getElementById("current-date").textContent = date;

    document.getElementById("current-time").textContent = time;
}

// Display the clock immediately
updateClock();

// Update the clock every second
setInterval(updateClock, 1000);


// ========================================
// LAST SUCCESSFUL DATA REFRESH
// ========================================

function updateRefreshTimestamp() {

    const now = new Date();

    const timestamp = now.toLocaleString("en-IE", {
        timeZone: "Europe/Dublin",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });

    document.getElementById("data-refresh-time").textContent =
        "Last successful refresh: " + timestamp;

    document.getElementById("last-updated").textContent =
        "Last successful refresh: " + timestamp;
}
// ========================================
// GOOGLE SHEETS INTEGRATION
// ========================================

const SHEET_ID =
    "1n5gRGWLSWcXWpWkHaF0QRetrzkjMmL7Aam7KjoZYQzc";

const SHEET_URL =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

let townResources = [];

async function loadGoogleSheet() {

    const status = document.getElementById("system-status");
    const statusDot = document.querySelector(".status-dot");

    status.textContent = "Connecting to Google Sheets";
    statusDot.style.background = "#C58B38";

    try {

        const response = await fetch(
            `${SHEET_URL}&_=${Date.now()}`,
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("Unable to retrieve spreadsheet");
        }

        const csv = await response.text();

        const result = Papa.parse(csv, {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: header => header.trim()
        });

        const requiredColumns = [
            "town",
            "county",
            "river",
            "crew_based_here",
            "barrier_sets",
            "pumps",
            "sandbags",
            "staff_on_call",
            "flow_override_m3s",
            "warning_override",
            "notes"
        ];

        if (
            result.errors.length ||
            result.meta.fields.length !== 11 ||
            !requiredColumns.every(column =>
                result.meta.fields.includes(column)
            )
        ) {
            throw new Error("Invalid spreadsheet structure");
        }

        const rows = result.data.filter(
            row => row.town && row.town.trim()
        );

        if (rows.length !== 8) {
            throw new Error("Expected eight monitored towns");
        }

        townResources = rows;

        renderTownResources();

await renderRiverData();

        status.textContent = "Resources connected";
        statusDot.style.background = "#69876B";

        updateRefreshTimestamp();

       document.getElementById("ai-summary").textContent =
    "Preliminary river flow assessments are displayed. Independent river validation, weather warnings and resource overrides are pending.";
        console.log("Google Sheet connected:", townResources);

    } catch (error) {

        status.textContent = "Resource connection failed";
        statusDot.style.background = "#A74739";

        document.getElementById("ai-summary").textContent =
            "Unable to refresh resource data. Please check the Google Sheet sharing settings and try again.";

        console.error("Google Sheets error:", error);
    }
}


// ========================================
// DISPLAY MONITORED TOWNS
// ========================================

function renderTownResources() {

    const table = document.getElementById("river-table");

    table.replaceChildren();

    townResources.forEach(town => {

        const row = document.createElement("tr");

        const values = [
            `${town.town}, Co. ${town.county}`,
            "Awaiting forecast",
            "--",
            "--",
            "Awaiting warnings",
            "Pending assessment",
            "--"
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        table.appendChild(row);
    });

    document.getElementById("town-count").textContent =
        String(townResources.length).padStart(2, "0");

    const townSelect = document.getElementById("town-select");

    townSelect.replaceChildren();

    townResources.forEach(town => {

        const option = document.createElement("option");

        option.value = town.town;
        option.textContent = `${town.town} — ${town.river}`;

        townSelect.appendChild(option);
    });
}


// ========================================
// REFRESH BUTTON
// ========================================

document.getElementById("refresh-data")
    .addEventListener("click", loadGoogleSheet);


// Load spreadsheet when website opens

loadGoogleSheet();
// ========================================
// RIVER DISCHARGE API
// ========================================

const FLOOD_API =
    "https://flood-api.open-meteo.com/v1/flood";

const riverStations = {

    "Clonmel": {
        river: "Suir",
        latitude: 52.35152,
        longitude: -7.694598
    },

    "Fermoy": {
        river: "Blackwater",
        latitude: 52.175003,
        longitude: -8.274994
    },

    "Mallow": {
        river: "Blackwater",
        latitude: 52.133,
        longitude: -8.640
    },

    "Bandon": {
        river: "Bandon",
        latitude: 51.775,
        longitude: -8.724991
    },

    "Enniscorthy": {
        river: "Slaney",
        latitude: 52.502,
        longitude: -6.566
    },

    "Ennis": {
        river: "Fergus",
        latitude: 52.825005,
        longitude: -9.024994
    },

    "Athlone": {
        river: "Shannon",
        latitude: 53.425003,
        longitude: -7.974991
    },

    "Carrick-on-Shannon": {
        river: "Shannon",
        latitude: 53.944,
        longitude: -8.096
    }

};

const historicalCache = {};


// ========================================
// PERCENTILE CALCULATION
// ========================================

function calculatePercentile(values, percentile) {

    const sorted = [...values].sort((a, b) => a - b);

    const index = (sorted.length - 1) * percentile;

    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return sorted[lower];
    }

    return sorted[lower] +
        (index - lower) *
        (sorted[upper] - sorted[lower]);
}


// ========================================
// HISTORICAL RIVER DISCHARGE
// ========================================

async function loadHistoricalData(town) {

    if (historicalCache[town]) {
        return historicalCache[town];
    }

    const station = riverStations[town];

    const url = `${FLOOD_API}?latitude=${station.latitude}` +
        `&longitude=${station.longitude}` +
        `&daily=river_discharge` +
        `&start_date=2016-01-01` +
        `&end_date=2025-12-31` +
        `&models=seamless_v4`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Historical data unavailable");
    }

    const data = await response.json();

    const values = data.daily.river_discharge;

    if (
        values.length !== 3653 ||
        !values.every(Number.isFinite) ||
        data.daily_units.river_discharge !== "m³/s"
    ) {
        throw new Error("Incomplete or invalid historical data");
    }

    const result = {
        dates: data.daily.time,
        discharge: values,
        observations: values.length,
        p95: calculatePercentile(values, 0.95),
        p99: calculatePercentile(values, 0.99),
        latitude: data.latitude,
        longitude: data.longitude
    };

    historicalCache[town] = result;

    return result;
}


// ========================================
// THREE-DAY FORECAST
// ========================================

async function loadRiverForecast(town) {

    const station = riverStations[town];

    const url = `${FLOOD_API}?latitude=${station.latitude}` +
        `&longitude=${station.longitude}` +
        `&daily=river_discharge` +
        `&forecast_days=3` +
        `&models=seamless_v4`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Forecast unavailable");
    }

    const data = await response.json();

    const values = data.daily.river_discharge;

    if (
        values.length !== 3 ||
        !values.every(Number.isFinite) ||
        data.daily_units.river_discharge !== "m³/s"
    ) {
        throw new Error("Incomplete or invalid forecast");
    }

    return {
        dates: data.daily.time,
        discharge: values,
        peak: Math.max(...values),
        latitude: data.latitude,
        longitude: data.longitude
    };
}


// ========================================
// CLONMEL DATA TEST
// ========================================

async function testClonmel() {

    try {

        const history = await loadHistoricalData("Clonmel");
        const forecast = await loadRiverForecast("Clonmel");

        console.table({
            "Town": "Clonmel",
            "River": "Suir (pending verification)",
            "Historical observations": history.observations,
            "95th percentile": history.p95.toFixed(2),
            "99th percentile": history.p99.toFixed(2),
            "Forecast peak": forecast.peak.toFixed(2),
            "Historical grid latitude": history.latitude,
            "Historical grid longitude": history.longitude,
            "Forecast grid latitude": forecast.latitude,
            "Forecast grid longitude": forecast.longitude
        });

    } catch (error) {

        console.error("River data test failed:", error);

    }
}

async function testAllStations() {

    const results = [];

    for (const town of Object.keys(riverStations)) {

        try {

            const history = await loadHistoricalData(town);
            const forecast = await loadRiverForecast(town);

            const mean =
                history.discharge.reduce((a, b) => a + b, 0)
                / history.observations;

            const sameGrid =
                history.latitude === forecast.latitude &&
                history.longitude === forecast.longitude;

            results.push({
                Town: town,
                River: riverStations[town].river,
                Observations: history.observations,
                Mean: mean.toFixed(2),
                P95: history.p95.toFixed(2),
                P99: history.p99.toFixed(2),
                Peak: forecast.peak.toFixed(2),
                Latitude: forecast.latitude,
                Longitude: forecast.longitude,
                GridMatch: sameGrid ? "Yes" : "No"
            });

        } catch (error) {

            results.push({
                Town: town,
                Error: error.message
            });

        }
    }

    console.table(results);
}

// ========================================
// PRELIMINARY FLOOD RISK CALCULATION
// ========================================

function calculateRisk(peak, p95, p99) {

    if (peak >= p99) {
        return "Barriers";
    }

    if (peak >= p95) {
        return "Standby";
    }

    return "Normal";
}


// ========================================
// DISPLAY RIVER DATA ON DASHBOARD
// ========================================

async function renderRiverData() {

    const table = document.getElementById("river-table");

    table.replaceChildren();

    let normal = 0;
    let standby = 0;
    let barriers = 0;

    for (const town of townResources) {

        const row = document.createElement("tr");

        try {

            const history =
                await loadHistoricalData(town.town);

            const forecast =
                await loadRiverForecast(town.town);

            if (
                history.latitude !== forecast.latitude ||
                history.longitude !== forecast.longitude
            ) {
                throw new Error("Grid mismatch");
            }

            const risk = calculateRisk(
                forecast.peak,
                history.p95,
                history.p99
            );

            if (risk === "Normal") normal++;
            if (risk === "Standby") standby++;
            if (risk === "Barriers") barriers++;

            const values = [
                `${town.town}, Co. ${town.county}`,
                `${forecast.peak.toFixed(2)} m³/s`,
                `${history.p95.toFixed(2)} m³/s`,
                `${history.p99.toFixed(2)} m³/s`,
                "Not checked",
                risk,
                "Preliminary — flow only"
            ];

            values.forEach((value, index) => {

                const cell = document.createElement("td");

                if (index === 5) {

                    const badge =
                        document.createElement("span");

                    badge.className =
                        `risk-badge ${risk.toLowerCase()}`;

                    badge.textContent = value;

                    cell.appendChild(badge);

                } else {

                    cell.textContent = value;

                }

                row.appendChild(cell);

            });

        } catch (error) {

            const values = [
                town.town,
                "Unavailable",
                "--",
                "--",
                "Not checked",
                "Unknown",
                error.message
            ];

            values.forEach(value => {

                const cell = document.createElement("td");

                cell.textContent = value;
                row.appendChild(cell);

            });
        }

        table.appendChild(row);
    }

    document.getElementById("normal-count").textContent =
        String(normal).padStart(2, "0");

    document.getElementById("standby-count").textContent =
        String(standby).padStart(2, "0");

    document.getElementById("critical-count").textContent =
        String(barriers).padStart(2, "0");
}
