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

await loadWeatherWarnings();

await renderRiverData();

        status.textContent = "Resources connected";
        statusDot.style.background = "#69876B";

        updateRefreshTimestamp();

       allocateCrews();

renderHistoricalInsights();

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

    const station = riverStations[town];

    const cacheKey =
        `riverwatch_history_v1_${town}_` +
        `${station.latitude}_${station.longitude}_` +
        `2016_2025_seamless_v4`;

    // 1. Check memory cache

    if (historicalCache[town]) {
        return historicalCache[town];
    }

    // 2. Check persistent browser cache

    try {

        const saved = localStorage.getItem(cacheKey);

        if (saved) {

            const cached = JSON.parse(saved);

            if (
                cached.discharge?.length === 3653 &&
                cached.dates?.length === 3653 &&
                cached.discharge.every(Number.isFinite) &&
                cached.dates[0] === "2016-01-01" &&
                cached.dates[3652] === "2025-12-31" &&
                cached.unit === "m³/s" &&
                Number.isFinite(cached.latitude) &&
                Number.isFinite(cached.longitude)
            ) {

                cached.p95 = calculatePercentile(
                    cached.discharge, 0.95
                );

                cached.p99 = calculatePercentile(
                    cached.discharge, 0.99
                );

                historicalCache[town] = cached;

                console.log(
                    `${town}: Historical data loaded from cache`
                );

                return cached;

            }

            localStorage.removeItem(cacheKey);

        }

    } catch (error) {

        console.warn("Historical cache unavailable:", town);

    }

    // 3. Download only if no valid cache exists

    const url = `${FLOOD_API}?latitude=${station.latitude}` +
        `&longitude=${station.longitude}` +
        `&daily=river_discharge` +
        `&start_date=2016-01-01` +
        `&end_date=2025-12-31` +
        `&models=seamless_v4`;

    const response = await fetch(url);

    if (!response.ok) {

        throw new Error(
            `Historical data unavailable: HTTP ${response.status}`
        );

    }

    const data = await response.json();

    const values = data.daily?.river_discharge;
    const dates = data.daily?.time;

    if (
        values?.length !== 3653 ||
        dates?.length !== 3653 ||
        !values.every(Number.isFinite) ||
        dates[0] !== "2016-01-01" ||
        dates[3652] !== "2025-12-31" ||
        data.daily_units?.river_discharge !== "m³/s" ||
        !Number.isFinite(data.latitude) ||
        !Number.isFinite(data.longitude)
    ) {

        throw new Error(
            "Incomplete or invalid historical data"
        );

    }

    const result = {
        dates: dates,
        discharge: values,
        observations: values.length,
        p95: calculatePercentile(values, 0.95),
        p99: calculatePercentile(values, 0.99),
        latitude: data.latitude,
        longitude: data.longitude,
        unit: "m³/s",
        source: "Open-Meteo Flood API",
        sourceUrl: url,
        model: "seamless_v4",
        retrievedAt: new Date().toISOString()
    };

    // 4. Save to memory

    historicalCache[town] = result;

    // 5. Save to persistent browser storage

    try {

        localStorage.setItem(
            cacheKey,
            JSON.stringify(result)
        );

        console.log(
            `${town}: Historical data downloaded and saved`
        );

    } catch (error) {

        console.warn(
            `${town}: Unable to save persistent cache`
        );

    }

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
    townAssessments = [];

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

           const override =
    String(town.flow_override_m3s || "").trim();

const isRehearsal = override !== "";

const effectivePeak = isRehearsal
    ? Number(override)
    : forecast.peak;

if (
    !Number.isFinite(effectivePeak) ||
    effectivePeak < 0
) {
    throw new Error("Invalid flow override");
}

const baseRisk = calculateRisk(
    effectivePeak,
    history.p95,
    history.p99
);

const warning = getTownWarning(town);

let risk = baseRisk;

if (
    warning.level === "orange" ||
    warning.level === "red"
) {

    if (risk === "Normal") {
        risk = "Standby";
    } else if (risk === "Standby") {
        risk = "Barriers";
    }
}

if (warning.level === "unknown") {
    risk = "Unknown";
}

const rehearsal =
    isRehearsal ||
    warning.source === "Rehearsal";

const warningLabel =
    warning.level === "none"
        ? "No rain warning"
        : warning.level === "unknown"
            ? "Unavailable"
            : warning.level.toUpperCase() + " rain";

const explanation =
    (rehearsal ? "REHEARSAL | " : "") +
    `Base: ${baseRisk} → ${risk}` +
    " | River validation pending";
townAssessments.push({
    town: town.town,
    risk: risk,
    peak: effectivePeak,
    p95: history.p95,
    p99: history.p99,
    barrierSets: Number(town.barrier_sets),
    pumps: Number(town.pumps),
    sandbags: Number(town.sandbags),
    staff: Number(town.staff_on_call),
    rehearsal: rehearsal,
    priority: history.p99 > 0
        ? ((effectivePeak - history.p99)
            / history.p99) * 100
        : null
});
            if (risk === "Normal") normal++;
            if (risk === "Standby") standby++;
            if (risk === "Barriers") barriers++;

            const values = [
    `${town.town}, Co. ${town.county}`,

    `${effectivePeak.toFixed(2)} m³/s` +
        (isRehearsal ? " (Rehearsal)" : ""),

    `${history.p95.toFixed(2)} m³/s`,

    `${history.p99.toFixed(2)} m³/s`,

    warningLabel +
        (warning.source === "Rehearsal"
            ? " (Rehearsal)" : ""),

    risk,

    explanation
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
// ========================================
// MET EIREANN WEATHER WARNINGS
// ========================================

const WEATHER_API =
    "https://www.met.ie/Open_Data/json/warning_IRELAND.json";

const countyCodes = {
    "Tipperary": "EI26",
    "Cork": "EI04",
    "Wexford": "EI30",
    "Clare": "EI03",
    "Westmeath": "EI29",
    "Leitrim": "EI14",
    "Roscommon": "EI24"
};

let weatherWarnings = null;
let weatherCheckedAt = null;

const warningRanks = {
    none: 0,
    yellow: 1,
    orange: 2,
    red: 3
};

async function loadWeatherWarnings() {

    weatherWarnings = null;
    weatherCheckedAt = null;

    try {

        const response = await fetch(WEATHER_API, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Weather feed unavailable");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("Invalid warning format");
        }

        for (const warning of data) {

            if (typeof warning.type !== "string") {
                throw new Error("Unknown warning schema");
            }

            if (warning.type.toLowerCase() === "rain") {

                if (
                    !Array.isArray(warning.regions) ||
                    !Number.isFinite(Date.parse(warning.onset)) ||
                    !Number.isFinite(Date.parse(warning.expiry)) ||
                    !["yellow", "orange", "red"].includes(
                        String(warning.level).toLowerCase()
                    )
                ) {
                    throw new Error("Invalid rain warning");
                }
            }
        }

        weatherWarnings = data;
        weatherCheckedAt = new Date();

    } catch (error) {

        console.error("Weather warning error:", error);

    }

    renderWeatherWarnings();
}


// ========================================
// COUNTY WARNING MATCHING
// ========================================

function getTownWarning(town) {

    const override =
        String(town.warning_override || "")
        .trim().toLowerCase();

    if (
        override &&
        !["orange", "red"].includes(override)
    ) {
        throw new Error("Invalid warning override");
    }

    if (weatherWarnings === null) {

        return {
            level: "unknown",
            source: "Feed unavailable"
        };
    }

    const codes = [
        countyCodes[town.county.trim()]
    ];

    if (!codes[0]) {
        throw new Error("Unknown county");
    }

    if (
        town.town === "Athlone" ||
        town.town === "Carrick-on-Shannon"
    ) {
        codes.push(countyCodes.Roscommon);
    }

    const now = Date.now();
    const next48Hours = now + 48 * 60 * 60 * 1000;

    let highest = "none";

    for (const warning of weatherWarnings) {

        const type =
            String(warning.type).toLowerCase();

        const level =
            String(warning.level).toLowerCase();

        if (type !== "rain") continue;

        const onset = Date.parse(warning.onset);
        const expiry = Date.parse(warning.expiry);

        const overlaps =
            onset <= next48Hours && expiry > now;

        const matchesCounty =
            warning.regions.some(code =>
                codes.includes(code)
            );

        if (
            overlaps &&
            matchesCounty &&
            warningRanks[level] > warningRanks[highest]
        ) {
            highest = level;
        }
    }

    if (override === "orange" || override === "red") {

        return {
            level: warningRanks[override] >
                warningRanks[highest]
                ? override : highest,
            source: "Rehearsal",
            liveLevel: highest
        };
    }

    return {
        level: highest,
        source: "Met Éireann"
    };
}


// ========================================
// DISPLAY OFFICIAL WEATHER WARNINGS
// ========================================

function renderWeatherWarnings() {

    const container =
        document.getElementById("weather-warnings");

    if (!container) return;

    container.replaceChildren();

    const source = document.createElement("p");

    source.textContent =
        "Source: Met Éireann | " +
        (weatherCheckedAt
            ? weatherCheckedAt.toLocaleString("en-IE")
            : "Connection unavailable");

    container.appendChild(source);

    if (weatherWarnings === null) {

        const message = document.createElement("p");

        message.textContent =
            "Warning data unavailable. Manual verification required.";

        container.appendChild(message);

        return;
    }

    if (weatherWarnings.length === 0) {

        const message = document.createElement("p");

        message.textContent =
            "No warnings reported by the latest official feed.";

        container.appendChild(message);

        return;
    }

    weatherWarnings.forEach(warning => {

        const item = document.createElement("div");

        const heading = document.createElement("h4");
        heading.textContent = warning.headline;

        const description = document.createElement("p");
        description.textContent = warning.description;

        const period = document.createElement("p");
        period.textContent =
            `${warning.onset} — ${warning.expiry}`;

        const regions = document.createElement("p");
        regions.textContent =
            "Regions: " +
            (Array.isArray(warning.regions)
                ? warning.regions.join(", ")
                : "See official feed");

        item.append(heading, description, period, regions);

        container.appendChild(item);
    });
}

let townAssessments = [];
// ========================================
// RESPONSE CREW ALLOCATION
// ========================================

let crewPlan = [];
let escalatedTowns = [];


function calculateCrewAllocation(assessments, resources) {

    const mallow = resources.find(
        town => town.town === "Mallow"
    );

    const vanRestricted =
        /van.*repair|mallow only/i.test(
            mallow?.notes || ""
        );

    const crews = [
        {
            id: "crew-1",
            name: "Clonmel Crew",
            capacity: 2,
            allowed: [
                "Clonmel",
                "Fermoy",
                "Enniscorthy"
            ],
            assigned: []
        },
        {
            id: "crew-2",
            name: "Mallow Crew",
            capacity: 2,
            allowed: vanRestricted
                ? ["Mallow"]
                : ["Mallow", "Fermoy", "Bandon"],
            assigned: [],
            restriction: vanRestricted
                ? "Van under repair — Mallow only"
                : ""
        },
        {
            id: "crew-3",
            name: "Athlone Crew",
            capacity: 2,
            allowed: [
                "Athlone",
                "Carrick-on-Shannon",
                "Ennis"
            ],
            assigned: []
        }
    ];

    const escalations = [];

    const barrierDemand = assessments
        .filter(town => town.risk === "Barriers")
        .sort((a, b) =>
            (b.priority ?? -Infinity) -
            (a.priority ?? -Infinity) ||
            b.peak - a.peak
        );

    // Find capacity, allowing reassignment of
    // previously allocated towns where possible.

    function assignTown(townName, visited = new Set()) {

        for (const crew of crews) {

            if (
                !crew.allowed.includes(townName) ||
                visited.has(crew.id)
            ) {
                continue;
            }

            visited.add(crew.id);

            if (crew.assigned.length < crew.capacity) {

                crew.assigned.push(townName);

                return true;
            }

            for (let i = 0; i < crew.assigned.length; i++) {

                const existingTown = crew.assigned[i];

                if (assignTown(existingTown, visited)) {

                    crew.assigned[i] = townName;

                    return true;
                }
            }
        }

        return false;
    }

    for (const town of barrierDemand) {

        if (
            !Number.isFinite(town.barrierSets) ||
            town.barrierSets < 1
        ) {

            escalations.push({
                town: town.town,
                reason: "No available barrier set",
                action: "Standby measures and Area Manager escalation"
            });

            continue;
        }

        if (!assignTown(town.town)) {

            escalations.push({
                town: town.town,
                reason: "No eligible crew capacity",
                action: "Standby measures and Area Manager escalation"
            });
        }
    }

    return {
        crews,
        escalations
    };
}


// Update the actual dashboard

function allocateCrews() {

    const result = calculateCrewAllocation(
        townAssessments,
        townResources
    );

    crewPlan = result.crews;

    escalatedTowns = result.escalations;

    renderCrewPlan();

    console.table(crewPlan);
    console.table(escalatedTowns);
}



// ========================================
// DISPLAY CREW ALLOCATION
// ========================================

function renderCrewPlan() {

    crewPlan.forEach(crew => {

        const container =
            document.getElementById(crew.id);

        if (!container) return;

        container.replaceChildren();

        const heading = document.createElement("h4");
        heading.textContent = crew.name;

        const capacity = document.createElement("p");

        capacity.textContent =
            `${crew.assigned.length} / ${crew.capacity} towns allocated`;

        container.append(heading, capacity);

        if (crew.assigned.length === 0) {

            const message = document.createElement("p");
            message.textContent = "No barrier allocation";
            container.appendChild(message);

        } else {

            crew.assigned.forEach(town => {

                const message = document.createElement("p");

                message.textContent =
                    `${town} — Proposed barriers before 18:00`;

                container.appendChild(message);
            });
        }

        if (crew.restriction) {

            const restriction = document.createElement("p");

            restriction.textContent = crew.restriction;
            restriction.style.color = "#A47B36";

            container.appendChild(restriction);
        }
    });

    const summary =
        document.getElementById("ai-summary");

    const rehearsal = townAssessments.some(
        town => town.rehearsal
    );

    const allocated = crewPlan.reduce(
        (total, crew) => total + crew.assigned.length,
        0
    );

    const unknownCount = townResources.length -
        townAssessments.filter(
            town => town.risk !== "Unknown"
        ).length;

    summary.textContent =
        (rehearsal ? "REHEARSAL MODE | " : "") +
        `${allocated} proposed barrier allocations. ` +
        `${escalatedTowns.length} towns require Area Manager escalation. ` +
        `${unknownCount} towns require manual data checks. ` +
        "River validation pending. " +
        "Duty Officer Aoife Brennan must approve the plan by 16:00. " +
        "AI can make mistakes; a person makes the final decision.";

    escalatedTowns.forEach(town => {

        const alert = document.createElement("p");

        alert.textContent =
            `${town.town}: ${town.reason}. ` +
            "Confirm staff, check pumps, stage sandbags " +
            "and escalate to the Area Manager.";

        summary.appendChild(alert);
    });
}
function analyseWinterFloods() {

    const results = [];

    for (const [town, history] of Object.entries(historicalCache)) {

        const winters = [];

        for (let year = 2016; year <= 2024; year++) {

            const start = `${year}-10-01`;
            const end = `${year + 1}-03-31`;

            let events = 0;
            let floodDays = 0;
            let inEvent = false;

            history.dates.forEach((date, index) => {

                if (date < start || date > end) return;

                const flow = history.discharge[index];

                if (flow >= history.p99) {

                    floodDays++;

                    if (!inEvent) {
                        events++;
                        inEvent = true;
                    }

                } else {
                    inEvent = false;
                }

            });

            winters.push({
                winter: `${year}/${year + 1}`,
                events: events,
                floodDays: floodDays
            });

        }

        const totalEvents = winters.reduce(
            (sum, winter) => sum + winter.events, 0
        );

        const firstFour = winters.slice(0, 4).reduce(
            (sum, winter) => sum + winter.events, 0
        );

        const lastFour = winters.slice(-4).reduce(
            (sum, winter) => sum + winter.events, 0
        );

        results.push({
            town: town,
            p99: history.p99,
            totalEvents: totalEvents,
            firstFour: firstFour,
            lastFour: lastFour,
            change: lastFour - firstFour,
            winters: winters
        });

    }

    return results.sort(
        (a, b) => b.totalEvents - a.totalEvents
    );

}

// ========================================
// HYDROLOGICAL ARCHIVE — DISPLAY ANALYTICS
// ========================================

let winterAnalysis = [];

function renderHistoricalInsights() {

    const priority = document.getElementById("archive-priority");

    if (Object.keys(historicalCache).length !== 8) {
        priority.textContent =
            "Incomplete historical data. Study recommendation unavailable.";
        return;
    }

    if (winterAnalysis.length === 0) {
        winterAnalysis = analyseWinterFloods();
    }

    const results = winterAnalysis;
    const top = results[0];

    const leaders = results.filter(
        town => town.totalEvents === top.totalEvents
    );

    const totalDays = top.winters.reduce(
        (sum, winter) => sum + winter.floodDays, 0
    );

    const percentageChange = top.firstFour > 0
        ? ((top.lastFour - top.firstFour) /
            top.firstFour * 100).toFixed(1)
        : null;

    const changeLabel = percentageChange === null
        ? "N/A"
        : (Number(percentageChange) > 0 ? "+" : "") +
            percentageChange + "%";

    const resource = townResources.find(
        town => town.town === top.town
    );

    // Priority town card

    priority.innerHTML = `
        <span class="archive-eyebrow">
            PROVISIONAL FLOOD DEFENCE STUDY PRIORITY
        </span>

        <h3>${leaders.map(t => t.town).join(" / ")}</h3>

        <p>${riverStations[top.town].river} River
            · County ${resource?.county || "Unknown"}</p>

        <div class="archive-metrics">

            <div class="archive-metric">
                <strong>${top.totalEvents}</strong>
                <span>Historical events</span>
            </div>

            <div class="archive-metric">
                <strong>${totalDays}</strong>
                <span>Threshold exceedance days</span>
            </div>

            <div class="archive-metric">
                <strong>${changeLabel}</strong>
                <span>Change between comparison periods</span>
            </div>

        </div>

        <p style="margin-top:20px;font-size:12px">
            ${leaders.length > 1
                ? "Joint priority. Metrics shown for " + top.town + "."
                : "Highest historical event frequency among monitored towns."}
            River validation pending.
        </p>
    `;

    // Historical ranking

    const ranking =
        document.getElementById("historical-ranking");

    const maximum = Math.max(
        1, ...results.map(town => town.totalEvents)
    );

    ranking.innerHTML = results.map(town => `

        <div class="archive-rank-row">

            <span>${town.town}</span>

            <div class="archive-bar-track">
                <div
                    class="archive-bar ${
                        town.totalEvents === top.totalEvents
                        ? "leading" : ""
                    }"
                    style="width:${
                        town.totalEvents / maximum * 100
                    }%">
                </div>
            </div>

            <strong>${town.totalEvents}</strong>

        </div>

    `).join("");

    // Town selection

    const select =
        document.getElementById("archive-town-select");

    const previousSelection = select.value;

    select.innerHTML = results.map(town => `
        <option value="${town.town}">
            ${town.town}
        </option>
    `).join("");

    select.value = results.some(
        town => town.town === previousSelection
    ) ? previousSelection : top.town;

    select.onchange = () => {
        renderWinterTimeline(select.value);
    };

    renderWinterTimeline(select.value);

    // Emerging historical trend

    const emerging = [...results].sort(
        (a, b) => b.change - a.change
    )[0];

    document.getElementById("archive-trend").innerHTML = `

        <span class="archive-eyebrow">
            AN EMERGING PATTERN
        </span>

        <h3>${emerging.town}</h3>

        <p>
            ${emerging.change > 0
                ? "Recorded the largest increase in event frequency."
                : "No increase in event frequency was identified."}
            The count changed from
            <strong>${emerging.firstFour} events</strong>
            in the first four winters to
            <strong>${emerging.lastFour} events</strong>
            in the last four winters.
        </p>

    `;

    // Comparison table

    document.getElementById(
        "historical-comparison"
    ).innerHTML = results.map(town => `

        <tr>
            <td>${town.town}</td>
            <td>${town.firstFour}</td>
            <td>${town.lastFour}</td>

            <td class="${
                town.change > 0
                    ? "archive-increase"
                    : town.change < 0
                        ? "archive-decrease" : ""
            }">
                ${town.change > 0 ? "+" : ""}${town.change}
            </td>
        </tr>

    `).join("");

}


// ========================================
// INTERACTIVE WINTER TIMELINE
// ========================================

function renderWinterTimeline(townName) {

    const town = winterAnalysis.find(
        item => item.town === townName
    );

    if (!town) return;

    const width = 480;
    const height = 260;
    const left = 38;
    const right = 24;
    const top = 30;
    const bottom = 45;

    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;

    const maxEvents = Math.max(
        5, ...town.winters.map(w => w.events)
    );

    const points = town.winters.map((winter, index) => ({

        x: left + index * chartWidth /
            (town.winters.length - 1),

        y: top + chartHeight -
            (winter.events / maxEvents) * chartHeight,

        events: winter.events,
        winter: winter.winter,
        floodDays: winter.floodDays

    }));

    const line = points.map(
        point => `${point.x},${point.y}`
    ).join(" ");

    const area = `
        ${left},${top + chartHeight}
        ${line}
        ${width - right},${top + chartHeight}
    `;

    let grid = "";

    for (let i = 0; i <= maxEvents; i++) {

        const y = top + chartHeight -
            i / maxEvents * chartHeight;

        grid += `
            <line
                x1="${left}" y1="${y}"
                x2="${width - right}" y2="${y}"
                stroke="#E5DBCD"
                stroke-dasharray="4 4"
            />

            <text
                x="24" y="${y + 4}"
                font-size="11"
                text-anchor="middle"
                fill="#786E61"
            >${i}</text>
        `;
    }

    document.getElementById("winter-timeline").innerHTML = `

        <svg viewBox="0 0 ${width} ${height}"
             role="img"
             aria-label="${townName} winter event timeline">

            ${grid}

            <polygon
                points="${area}"
                fill="#B58A49"
                opacity="0.13"
            />

            <polyline
                points="${line}"
                fill="none"
                stroke="#B58A49"
                stroke-width="3"
                stroke-linejoin="round"
            />

            ${points.map(point => `

                <circle
                    cx="${point.x}"
                    cy="${point.y}"
                    r="5"
                    fill="${
                        point.events === maxEvents
                        ? "#B66D50" : "#B58A49"
                    }"
                    stroke="#FFFAF2"
                    stroke-width="2"
                >
                    <title>
                        ${point.winter}:
                        ${point.events} events,
                        ${point.floodDays} exceedance days
                    </title>
                </circle>

                <text
                    x="${point.x}"
                    y="${point.y - 12}"
                    font-size="12"
                    text-anchor="middle"
                    fill="#263747"
                >${point.events}</text>

                <text
                    x="${point.x}"
                    y="${height - 20}"
                    font-size="10"
                    text-anchor="middle"
                    fill="#786E61"
                >${
                    point.winter.slice(2, 4) + "/" +
                    point.winter.slice(-2)
                }</text>

            `).join("")}

        </svg>

        <p style="text-align:center;margin:10px 0">
            ${town.totalEvents} events across nine winters
            · P99: ${town.p99.toFixed(2)} m³/s
        </p>

    `;

}

// ========================================
// RIVERSENSE AI — CHAT CONTROLS
// ========================================

const chatPanel = document.getElementById("chat-panel");
const chatToggle = document.getElementById("chat-toggle");
const askAIButton = document.getElementById("ask-ai");
const closeChat = document.getElementById("close-chat");

function openRiverSense() {
    chatPanel.hidden = false;
}

function closeRiverSense() {
    chatPanel.hidden = true;
}

chatToggle.addEventListener("click", openRiverSense);

askAIButton.addEventListener("click", openRiverSense);

closeChat.addEventListener("click", closeRiverSense);


// ========================================
// AI SETTINGS TOGGLE
// ========================================

const settingsToggle =
    document.getElementById("ai-settings-toggle");

const aiSettings =
    document.getElementById("ai-settings");

settingsToggle.addEventListener("click", () => {

    aiSettings.hidden = !aiSettings.hidden;

    settingsToggle.setAttribute(
        "aria-expanded",
        String(!aiSettings.hidden)
    );

});


// ========================================
// SUGGESTED QUESTIONS
// ========================================

document.querySelectorAll(".suggested-question")
    .forEach(button => {

        button.addEventListener("click", () => {

            const input =
                document.getElementById("chat-input");

            input.value = button.textContent.trim();

            input.focus();

        });

    });

const AI_BACKEND_URL =
    "https://river-watch-ai.dadithanusha.workers.dev";

let aiQuestionCount = 0;
let aiTotalCost = 0;
let aiConnected = false;

async function checkAIConnection() {

    const status = document.getElementById(
        "ai-connection-status"
    );

    const dot = document.getElementById(
        "ai-connection-dot"
    );

    try {

        const response = await fetch(AI_BACKEND_URL, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Backend unavailable");
        }

        const data = await response.json();

        aiConnected =
            data.status === "online" &&
            data.keyConfigured === true;

        if (!aiConnected) {
            throw new Error("AI not configured");
        }

        status.textContent = "AI service connected";
        status.style.color = "#15803d";
        dot.style.backgroundColor = "#22c55e";

    } catch (error) {

        aiConnected = false;

        status.textContent = "AI service unavailable";
        status.style.color = "#dc2626";
        dot.style.backgroundColor = "#ef4444";

    }
}

function updateAIUsage(usage) {

    aiQuestionCount++;

    aiTotalCost += Number(
        usage?.estimatedCostUSD || 0
    );

    document.getElementById(
        "ai-question-count"
    ).textContent = aiQuestionCount;

    document.getElementById(
        "ai-total-cost"
    ).textContent = "$" + aiTotalCost.toFixed(4);

}

checkAIConnection();

const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

let aiRequestInProgress = false;

// Display chat messages

function addChatMessage(message, role) {

    const messageElement = document.createElement("div");

    messageElement.className =
        role === "user"
            ? "user-message"
            : "assistant-message";

    messageElement.textContent = message;

    chatMessages.appendChild(messageElement);

    chatMessages.scrollTop = chatMessages.scrollHeight;

    return messageElement;

}

// Enable or disable the chat input

function setChatLoading(isLoading) {

    aiRequestInProgress = isLoading;

    chatInput.disabled = isLoading;

    const submitButton = chatForm.querySelector(
        'button[type="submit"]'
    );

    if (submitButton) {
        submitButton.disabled = isLoading;
    }

    document.querySelectorAll(".suggested-question")
        .forEach(button => {
            button.disabled = isLoading;
        });

}

// Handle question submission


chatForm.addEventListener("submit", async function(event) {

    event.preventDefault();

    const question = chatInput.value.trim();

    if (!question || aiRequestInProgress) {
        return;
    }

    if (question.length > 500) {

        addChatMessage(
            "Please keep your question within 500 characters.",
            "assistant"
        );

        return;
    }

    addChatMessage(question, "user");

    chatInput.value = "";

    setChatLoading(true);

    const loadingMessage = addChatMessage(
        "Refreshing RiverWatch data...",
        "assistant"
    );

    try {

        // Refresh the operational data

if (checkOutOfScope(question)) {

    loadingMessage.textContent =
        "This question is outside the scope of RiverWatch.\n\n" +

        "RiverWatch provides town-level river flow " +
        "assessments and operational flood response support. " +

        "It cannot predict flooding at individual properties " +
        "or advise on coastal flooding, road closures " +
        "or insurance matters.\n\n" +

        "Please contact your local council area office " +
        "for specific guidance.\n\n" +

        "AI can make mistakes; a person makes the final decision.";

    return;

}

        await loadGoogleSheet();

        // Build the calculated decision context

        const context = buildAIContext();

        // Prevent advice based on incomplete data

        if (!context.assessmentComplete) {

const hypothetical = parseHypotheticalQuestion(question);

if (hypothetical) {

    if (hypothetical.error) {

        loadingMessage.textContent = hypothetical.error;

        return;

    }

    const scenario =
        calculateHypotheticalScenario(hypothetical);

    if (scenario.error) {

        loadingMessage.textContent = scenario.error;

        return;

    }

    context.hypotheticalScenario = scenario;

}

            loadingMessage.textContent =
                "RiverSense cannot provide a reliable " +
                "operational assessment because some river " +
                "data is currently unavailable. " +
                "Please try again when the data sources " +
                "are restored.";

            return;

        }

        loadingMessage.textContent =
            "RiverSense is analysing the latest assessments...";

        // Send question and calculated context

        const response = await fetch(AI_BACKEND_URL, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                question,
                context
            })

        });

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.error || "AI request failed"
            );

        }

        if (!data.answer) {
            throw new Error("No AI answer received");
        }

        // Display AI response

        loadingMessage.textContent = data.answer;

        // Update usage and estimated cost

        updateAIUsage(data.usage);

        console.log("RiverSense response:", {

            question: question,

            model: data.model,

            timestamp: data.timestamp,

            usage: data.usage

        });

    } catch (error) {

        loadingMessage.textContent =
            "RiverSense could not complete your request. " +
            "Please try again later.";

        console.error("RiverSense error:", error);

    } finally {

        setChatLoading(false);

        chatMessages.scrollTop =
            chatMessages.scrollHeight;

        chatInput.focus();

    }

});


function buildAIContext() {

    const assessments = townAssessments.map(item => ({

        town: item.town,

        forecastPeakM3s: item.peak,

        p95: item.p95,

        p99: item.p99,

        recommendation: item.risk,

        barrierSets: item.barrierSets,

        pumps: item.pumps,

        sandbags: item.sandbags,

        staffOnCall: item.staff,

        rehearsal: item.rehearsal,

        percentageAboveP99: item.priority

    }));

    return {

        application: "RiverWatch",

        country: "Ireland",

        contextCreatedAt: new Date().toISOString(),

        assessmentComplete: assessments.length === 8 &&
            assessments.every(item =>
                ["Normal", "Standby", "Barriers"]
                    .includes(item.recommendation)
            ),

        riverUnit: "m³/s",

        historicalPeriod: {
            start: "2016-01-01",
            end: "2025-12-31"
        },

        forecastPeriod: "Today and next two days",

        sources: {

            resources: {
                name: "RiverWatch Google Sheet",
                records: townResources
            },

            riverForecasts: {
                name: "Open-Meteo Flood API",
                model: "seamless_v4",
                url: FLOOD_API
            },

            historicalData: {
                name: "Open-Meteo Flood API",
                model: "seamless_v4",
                stations: Object.entries(historicalCache)
                    .map(([town, data]) => ({
                        town,
                        observations: data.observations,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        retrievedAt: data.retrievedAt,
                        sourceUrl: data.sourceUrl,
                        p95: data.p95,
                        p99: data.p99
                    }))
            },

            weatherWarnings: {
                name: "Met Éireann",
                checkedAt: weatherCheckedAt,
                warnings: weatherWarnings
            }

        },

        townAssessments: assessments,

        crewAllocation: crewPlan,

        areaManagerEscalations: escalatedTowns,

        historicalAnalysis: winterAnalysis,

        decisionRules: {

            normal: "Forecast peak below P95",

            standby: "Forecast peak at or above P95 but below P99",

            barriers: "Forecast peak at or above P99",

            warningEscalation:
                "Orange or red rain warning raises risk by one level",

            yellowWarning:
                "Mention warning without raising risk",

            standbyActions: [
                "Confirm staff availability",
                "Check pumps",
                "Stage sandbags"
            ],

            barrierDeadline: "18:00",

            crewCapacity: "Maximum two towns per crew per night",

            barrierPriority:
                "Percentage above P99, then higher forecast peak",

            unservedBarrierTown:
                "Apply standby measures and escalate to Area Manager"

        },

        decisionAuthority: {

            dutyOfficer: "Aoife Brennan",

            approvalDeadline: "16:00",

            automaticDispatch: false

        },

        limitations: [
            "Academic decision-support prototype",
            "Independent river station validation pending",
            "Historical exceedances are not confirmed flood incidents",
            "Missing data must not be interpreted as normal risk",
            "Human approval is required"
        ],

        disclaimer:
            "AI can make mistakes; a person makes the final decision."

    };

}

function parseHypotheticalQuestion(question) {

    const isHypothetical =
        /\b(what\s+if|suppose|hypothetical|imagine|assuming|assume)\b/i
            .test(question);

    if (!isHypothetical) {
        return null;
    }

    const matchedTowns = Object.keys(riverStations)
        .filter(name =>
            question.toLowerCase()
                .includes(name.toLowerCase())
        );

    if (matchedTowns.length !== 1) {

        return {
            error: "Please specify one RiverWatch town."
        };

    }

    const town = matchedTowns[0];

    const flowMatch = question.match(
        /(-?\d+(?:\.\d+)?)\s*(?:m³\/s|m3\/s|m\^3\/s|cumecs|cubic metres per second)/i
    );

    if (!flowMatch) {

        return {
            error: "Please specify a flow value in m³/s."
        };

    }

    const flow = Number(flowMatch[1]);

    if (!Number.isFinite(flow) || flow < 0) {

        return {
            error: "Please enter a valid non-negative river flow."
        };

    }

    return {
        town: town,
        hypotheticalFlow: flow,
        unit: "m³/s",
        mode: "Hypothetical scenario"
    };

}

function calculateHypotheticalScenario(scenario) {

    const original = townAssessments.find(
        item => item.town === scenario.town
    );

    const resources = townResources.find(
        item => item.town === scenario.town
    );

    if (!original || !resources) {

        return {
            error: "Required town data is unavailable."
        };

    }

    const flow = scenario.hypotheticalFlow;

    const baseRisk = calculateRisk(
        flow,
        original.p95,
        original.p99
    );

    let finalRisk = baseRisk;

    const warning = getTownWarning(resources);

    const warningLevel =
        typeof warning === "string"
            ? warning.toLowerCase()
            : String(warning?.level || "").toLowerCase();

    if (
        warningLevel === "orange" ||
        warningLevel === "red"
    ) {

        if (baseRisk === "Normal") {

            finalRisk = "Standby";

        } else if (baseRisk === "Standby") {

            finalRisk = "Barriers";

        }
    }

    // Create a separate scenario assessment

    const scenarioAssessments = townAssessments.map(
        item => ({ ...item })
    );

    const target = scenarioAssessments.find(
        item => item.town === scenario.town
    );

    target.peak = flow;

    target.risk = finalRisk;

    target.priority =
        ((flow - original.p99) / original.p99) * 100;

    // Recalculate crew allocation without
    // modifying the live dashboard

    const allocation = calculateCrewAllocation(
        scenarioAssessments,
        townResources
    );

    const assignedCrew = allocation.crews.find(
        crew => crew.assigned.includes(scenario.town)
    );

    const escalation = allocation.escalations.find(
        item => item.town === scenario.town
    );

    return {

        mode: "Hypothetical scenario",

        town: scenario.town,

        river: resources.river,

        unit: "m³/s",

        currentEffectivePeak: original.peak,

        hypotheticalFlow: flow,

        p95: original.p95,

        p99: original.p99,

        currentRecommendation: original.risk,

        hypotheticalBaseRisk: baseRisk,

        hypotheticalFinalRisk: finalRisk,

        weatherWarning: warning,

        percentageAboveP99: target.priority,

        resources: {
            barrierSets: original.barrierSets,
            pumps: original.pumps,
            sandbags: original.sandbags,
            staffOnCall: original.staff
        },

        assignedCrew: assignedCrew?.name || null,

        escalation: escalation || null,

        revisedCrewAllocation: allocation.crews,

        revisedEscalations: allocation.escalations,

        dashboardModified: false,

        googleSheetModified: false,

        approvalRequired: true,

        calculatedAt: new Date().toISOString()

    };

}

function checkOutOfScope(question) {

    const patterns = [
        /\b(house|home|property|properties|residence|apartment|address|eirc ode|eircode)\b/i,
        /\b(coastal|tidal|storm surge|sea flooding)\b/i,
        /\b(road closure|road closures|road closed|roads closed|road flooded)\b/i,
        /\b(insurance|insurance claim|compensation)\b/i
    ];

    return patterns.some(pattern =>
        pattern.test(question)
    );

}

let decisionRecords = [];

try {
    decisionRecords = JSON.parse(
        localStorage.getItem("riverwatch_decisions") || "[]"
    );

    if (!Array.isArray(decisionRecords)) {
        decisionRecords = [];
    }

} catch {
    decisionRecords = [];
}

function renderDecisionRecords() {

    const container =
        document.getElementById("decision-records");

    container.replaceChildren();

    if (decisionRecords.length === 0) {

        container.textContent = "No decisions recorded yet.";

        return;
    }

    decisionRecords.slice().reverse().forEach(record => {

        const card = document.createElement("div");
        card.className = "decision-record";

        const heading = document.createElement("h4");
        heading.textContent = record.decision;

        const time = document.createElement("p");

        time.textContent =
            "Recorded: " +
            new Date(record.timestamp).toLocaleString(
                "en-IE",
                { timeZone: "Europe/Dublin" }
            );

        const reason = document.createElement("p");
        reason.textContent = "Reason: " + record.reason;

        const plan = document.createElement("p");
        plan.textContent = "Reviewed plan: " + record.plan;

        card.append(heading, time, reason, plan);

        container.appendChild(card);

    });
}

document.getElementById("decision-form")
    .addEventListener("submit", function(event) {

        event.preventDefault();

        const decision = document.getElementById(
            "officer-decision"
        ).value;

        const reason = document.getElementById(
            "decision-reason"
        ).value.trim();

        if (!decision || !reason) {
            alert("Please select a decision and enter a reason.");
            return;
        }

        const context = buildAIContext();

        if (
            !context.assessmentComplete ||
            weatherWarnings === null
        ) {

            alert(
                "A complete operational assessment is required " +
                "before recording a decision."
            );

            return;
        }

        const record = {

            timestamp: new Date().toISOString(),

            officer: "Aoife Brennan",

            decision: decision,

            reason: reason,

            plan: document.getElementById(
                "ai-summary"
            ).textContent,

            townAssessments: context.townAssessments,

            crewAllocation: context.crewAllocation,

            escalations: context.areaManagerEscalations

        };

        try {

            const updatedRecords = [
                ...decisionRecords,
                record
            ];

            localStorage.setItem(
                "riverwatch_decisions",
                JSON.stringify(updatedRecords)
            );

            decisionRecords = updatedRecords;

        } catch {

            alert("Unable to save the decision.");
            return;

        }

        renderDecisionRecords();

        event.target.reset();

    });

renderDecisionRecords();

loadGoogleSheet();
