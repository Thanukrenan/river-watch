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
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

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

        status.textContent = "Resources connected";
        statusDot.style.background = "#69876B";

        updateRefreshTimestamp();

        document.getElementById("ai-summary").textContent =
            "Resource data for eight Irish towns has been successfully retrieved. River forecasts and weather warnings are awaiting integration.";

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
