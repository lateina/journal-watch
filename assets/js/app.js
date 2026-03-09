const SCHEDULE_BIN_ID = "699332e2ae596e708f2f7434"; // Schedule
const EMPLOYEES_BIN_ID = "699333dcd0ea881f40bf132f"; // Employees
const DISTRIBUTION_BIN_ID = "699c40edae596e708f42284d"; // Distribution

let currentSchedule = [];
let currentEmployees = [];
let currentDistribution = [];
let isAdmin = false;
let apiKey = null;
let hasUnsavedChanges = false;

window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});

function setupEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.getAttribute('data-tab')));
    });

    // Admin Buttons
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) loginBtn.addEventListener('click', showLogin);

    // Modal Buttons
    const modLoginBtn = document.querySelector('#login-box button:first-of-type'); // Login
    const modCancelBtn = document.querySelector('#login-box button:last-of-type'); // Cancel
    if (modLoginBtn) modLoginBtn.addEventListener('click', checkLogin);
    if (modCancelBtn) modCancelBtn.addEventListener('click', hideLogin);

    // Save/Logout
    const saveBtn = document.querySelector('.save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveSchedule);

    const logoutBtn = document.querySelector('#logout-btn'); // Logout
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Add Employee
    // Handled via inline onclick in index.html to ensure reliability
    // const addEmpBtn = document.getElementById('add-employee-btn');
    // if (addEmpBtn) {
    //    addEmpBtn.addEventListener('click', addEmployee);
    // }

    // Print Button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) printBtn.addEventListener('click', () => showPrintModal());
}

// --- Initialization ---

async function init() {
    console.log("App initializing...");
    setupEventListeners(); // Bind events first

    // Check local storage for key
    const storedKey = localStorage.getItem('journal_api_key');
    if (storedKey) {
        apiKey = storedKey;
        isAdmin = true; // If we have a key, we are admin (since there is only one key)
        document.getElementById('login-btn').classList.add('hidden');
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');
    }

    setupTabs();

    // Load data
    await loadSchedule();
    await loadEmployees();
    await loadDistribution();

    // Ensure UI reflects admin state AFTER loading
    updateAdminUI();
}

document.addEventListener('DOMContentLoaded', init);

// --- Data Loading ---

async function fetchData(binId) {
    if (!apiKey) {
        throw new Error("Bitte einloggen.");
    }

    const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        headers: { "X-Master-Key": apiKey }
    });

    if (response.status === 401 || response.status === 403) {
        throw new Error("Zugriff verweigert (Falscher Key?).");
    }

    if (!response.ok) throw new Error(`Fehler: ${response.status}`);
    const data = await response.json();
    return data.record;
}

async function loadSchedule() {
    try {
        currentSchedule = await fetchData(SCHEDULE_BIN_ID);
        renderSchedule();
    } catch (e) {
        showError("Fehler beim Laden des Plans: " + e.message);
    }
}

async function loadEmployees() {
    try {
        currentEmployees = await fetchData(EMPLOYEES_BIN_ID);
        if (!Array.isArray(currentEmployees)) {
            console.warn("Mitarbeiter-Daten sind kein Array. Initialisiere neu.", currentEmployees);
            currentEmployees = [];
        }
        syncEmployeeIDs();
        renderEmployees();
        renderSchedule(); // Re-render schedule to populate dropdowns
    } catch (e) {
        console.warn("Fehler beim Laden der Mitarbeiter:", e);
        currentEmployees = []; // Fallback
        renderEmployees();
    }
}

async function loadDistribution() {
    try {
        currentDistribution = await fetchData(DISTRIBUTION_BIN_ID);
        if (!Array.isArray(currentDistribution)) {
            console.warn("Distribution-Daten sind kein Array.", currentDistribution);
            currentDistribution = [];
        }
        syncEmployeeIDs();
        renderDistribution();
    } catch (e) {
        console.warn("Fehler beim Laden der Monatsverteilung:", e);
        currentDistribution = [];
        renderDistribution();
    }
}

function syncEmployeeIDs() {
    console.log("syncEmployeeIDs called", {
        empCount: currentEmployees.length,
        distCount: currentDistribution.length
    });

    if (!currentEmployees.length || !currentDistribution.length) return;

    let changed = false;
    const exclusions = ["93", "elternzeit", "donaustauf", "kelheim", "med1", "med3"];

    // 1. Update IDs for existing employees
    currentEmployees.forEach(emp => {
        if (!emp.name) return;

        // Find if this employee has an ID in the distribution data
        // Search by name (en) - trim and case-insensitive
        const cleanEmpName = emp.name.trim().toLowerCase();

        // Exact match first
        let match = currentDistribution.find(d => d.en && d.en.trim().toLowerCase() === cleanEmpName);

        // Fallback: Check if distribution name matches the employee's last name
        if (!match) {
            const parts = emp.name.trim().split(/\s+/);
            if (parts.length > 0) {
                const lastName = parts[parts.length - 1].toLowerCase();
                match = currentDistribution.find(d => d.en && d.en.trim().toLowerCase() === lastName);
            }
        }

        if (match) {
            if (match.ei && (!emp.id || emp.id === "")) {
                emp.id = match.ei;
                changed = true;
                console.log(`Assigned ID ${match.ei} to existing employee ${emp.name}`);
            }
        }
    });

    // 2. Discover new employees
    currentDistribution.forEach(d => {
        if (!d.en || !d.ei) return;

        // Skip if this specific entry is in an excluded area
        const area = (d.bi || "").toLowerCase();
        if (exclusions.some(ex => area.includes(ex))) return;

        const distId = d.ei.trim();
        const distName = d.en.trim();

        // Check if already exists in currentEmployees
        const exists = currentEmployees.find(emp => {
            if (emp.id === distId) return true;

            const cleanEmpName = (emp.name || "").trim().toLowerCase();
            const cleanDistName = distName.toLowerCase();
            if (cleanEmpName === cleanDistName) return true;

            const empParts = cleanEmpName.split(/\s+/);
            if (empParts.length > 0 && empParts[empParts.length - 1] === cleanDistName) return true;

            return false;
        });

        if (!exists) {
            console.log(`New employee discovered: ${distName} (${distId}) in area ${d.bi}`);
            currentEmployees.push({
                id: distId,
                name: distName,
                email: "@",
                active: true,
                isOberarzt: false
            });
            changed = true;
        }
    });

    if (changed) {
        console.log("Sync complete, table updated.");
        renderEmployees();
    } else {
        console.log("Sync complete, no changes.");
    }
}

function renderDistribution() {
    const table = document.getElementById('distribution-table');
    const tbody = document.getElementById('distribution-body');
    if (!tbody || !table) return;

    table.classList.remove('hidden');
    tbody.innerHTML = '';

    currentDistribution.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.mi || ''}</td>
            <td>${item.bi || ''}</td>
            <td>${item.ei || ''}</td>
            <td>${item.en || ''}</td>
        `;
        tbody.appendChild(row);
    });
}

function showError(msg) {
    const errorDiv = document.getElementById('error-message');
    const loadingDiv = document.getElementById('loading');

    if (errorDiv) {
        errorDiv.textContent = msg;
        errorDiv.classList.remove('hidden');
    } else {
        console.error("Error (UI missing):", msg);
        alert(msg);
    }

    if (loadingDiv) loadingDiv.classList.add('hidden');
}

// --- Rendering ---

function renderSchedule() {
    const tbody = document.getElementById('schedule-body');
    const table = document.getElementById('schedule-table');
    document.getElementById('loading').classList.add('hidden');

    // Hide error message on successful render
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.style.display = ''; // Reset inline display if any
    }

    table.classList.remove('hidden');

    currentSchedule.sort((a, b) => new Date(a.date) - new Date(b.date));
    const today = new Date().toISOString().split('T')[0];

    tbody.innerHTML = '';

    // Calculate stats
    const stats = {};
    const forgottenStats = {};

    currentSchedule.forEach(s => {
        // Only count frequency if assigned AND NOT forgotten AND NOT holiday
        if (s.presenter && s.presenter !== "" && !checkHoliday(new Date(s.date))) {
            if (!s.forgotten) {
                stats[s.presenter] = (stats[s.presenter] || 0) + 1;
            } else {
                forgottenStats[s.presenter] = (forgottenStats[s.presenter] || 0) + 1;
            }
        }
    });

    currentSchedule.forEach((slot, index) => {
        const row = document.createElement('tr');
        const dateObj = new Date(slot.date);
        const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });

        // Check for Holiday / Vacation
        const holidayName = checkHoliday(dateObj);

        let presenterCell = slot.presenter || '<span style="color:#ccc">Frei</span>';
        let topicCell = slot.topic || '';
        let isHoliday = false;
        let countCell = "";
        let forgottenCell = "";
        let ersatzCell = "";
        let combinedStatsCell = "";

        if (holidayName) {
            isHoliday = true;
            row.classList.add('holiday-row');
            presenterCell = `<strong>${holidayName}</strong>`;
            topicCell = "Kein Journal Watch";
            combinedStatsCell = "-";
            forgottenCell = "-";
            ersatzCell = "-";
        } else {
            const count = (slot.presenter && stats[slot.presenter]) ? stats[slot.presenter] : 0;
            const fCount = (slot.presenter && forgottenStats[slot.presenter]) ? forgottenStats[slot.presenter] : 0;

            // Format: "Held / Forgotten"
            // Highlight forgotten count in red if > 0
            const fCountDisplay = fCount > 0 ? `<span style="color:red; font-weight:bold;">${fCount}</span>` : "0";
            combinedStatsCell = `${count} / ${fCountDisplay}`;

            // Forgotten Checkbox
            if (isAdmin && slot.presenter) {
                const checked = slot.forgotten ? 'checked' : '';
                forgottenCell = `<input type="checkbox" ${checked} onchange="toggleForgotten(${index}, this.checked)">`;
            } else {
                forgottenCell = slot.forgotten ? "Ja" : "";
            }

            if (slot.forgotten) row.classList.add('forgotten-row');

            // Ersatztermin Logic
            if (isAdmin) {
                const checked = slot.isNachholtermin ? 'checked' : '';
                ersatzCell = `<input type="checkbox" ${checked} onchange="toggleErsatztermin(${index}, this.checked)">`;
            } else {
                ersatzCell = slot.isNachholtermin ? "Ja" : "";
            }

            // specific check for OA
            if (slot.presenter) {
                const emp = currentEmployees.find(e => e.name === slot.presenter);
                if (emp && emp.isOberarzt) {
                    row.classList.add('oa-row');
                }
            }
        }

        if (isAdmin && !isHoliday) {
            if (slot.forgotten && slot.presenter) {
                // If forgotten, show static name with strikethrough
                presenterCell = `<span style="text-decoration: line-through; color: #888; font-weight: bold;">${slot.presenter}</span>`;
            } else {
                // Build Dropdown
                // Determine Role based on Day (Monday=AA, Wednesday=OA)
                const day = dateObj.getDay();
                const isOberarztDay = (day === 3);

                let options = `<option value="">-- Wähle Referent --</option>`;
                if (currentEmployees && Array.isArray(currentEmployees)) {
                    // Sort by name for dropdown
                    const sortedEmps = [...currentEmployees].sort(sortEmployeesByName);
                    sortedEmps.forEach(emp => {
                        if (emp.active) {
                            // Filter by role matching the day
                            if (!!emp.isOberarzt === isOberarztDay || slot.presenter === emp.name) {
                                const selected = (slot.presenter === emp.name) ? 'selected' : '';
                                options += `<option value="${emp.name}" ${selected}>${emp.name}</option>`;
                            }
                        }
                    });
                }
                // Keep current value if not in list (legacy support)
                if (slot.presenter && (!currentEmployees || !currentEmployees.find(e => e.name === slot.presenter && e.active))) {
                    options += `<option value="${slot.presenter}" selected>${slot.presenter} (Archiv)</option>`;
                }

                presenterCell = `<select class="edit-field" onchange="updateSlot(${index}, 'presenter', this.value)">${options}</select>`;
            }
            topicCell = `<input class="edit-field" value="${slot.topic || ''}" onchange="updateSlot(${index}, 'topic', this.value)" placeholder="Thema">`;
        }

        row.innerHTML = `
            <td>${dateObj.toLocaleDateString('de-DE')}</td>
            <td>${dayName}</td>
            <td>${presenterCell}</td>
            <td class="center-text stats-tooltip">${combinedStatsCell}</td>
            <td class="center-text">${forgottenCell}</td>
            <td class="center-text">${ersatzCell}</td>
            <td class="center-text">
                ${isAdmin ? (() => {
                if (slot.forgotten) return '-';

                // Determine Role for Swap Filter
                let isOberarztSlot = false;
                const day = dateObj.getDay();

                if (slot.presenter && slot.presenter !== "") {
                    // If assigned, use the assigned person's role
                    const assignedEmp = currentEmployees.find(e => e.name === slot.presenter);
                    if (assignedEmp) isOberarztSlot = !!assignedEmp.isOberarzt;
                } else {
                    // If empty, use day rule
                    if (day === 3) isOberarztSlot = true; // Wednesday = OA
                    // else Monday = AA (false)
                }

                const swapOptions = [...currentEmployees]
                    .filter(e => {
                        const hasAppointments = (stats[e.name] || 0) + (forgottenStats[e.name] || 0) > 0;
                        return e.active && e.name !== slot.presenter && !!e.isOberarzt === isOberarztSlot && hasAppointments;
                    })
                    .sort(sortEmployeesByName)
                    .map(e => `<option value="${e.name}">${e.name}</option>`)
                    .join('');

                return `<select class="swap-select" onchange="handleSwap(${index}, this.value)">
                        <option value="">Tauschen...</option>
                        ${swapOptions}
                    </select>`;
            })() : '-'}
            </td>
            <td>${topicCell}</td>
        `;

        if (slot.date < today) {
            row.classList.add('past-row');
            if (!isHoliday && !slot.forgotten) row.style.opacity = '0.5';
        }
        tbody.appendChild(row);
    });

    updateAdminUI();

    // Update Print Header "Stand" date
    const standDateEl = document.getElementById('print-stand-date');
    if (standDateEl) {
        const now = new Date();
        standDateEl.textContent = "Stand: " + now.toLocaleDateString('de-DE');
    }
}

// --- Helper: Holidays (Bavaria, 2026 + 2027) ---
function checkHoliday(dateObj) {
    const time = dateObj.getTime();
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1; // 1-12
    const day = dateObj.getDate();
    const dateStr = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.`;

    // Fixed public holidays (same date every year, Bavaria)
    const fixedHolidays = {
        "01.01.": "Neujahr",
        "06.01.": "Heilige Drei Könige",
        "01.05.": "Tag der Arbeit",
        "15.08.": "Mariä Himmelfahrt",
        "03.10.": "Tag der Deutschen Einheit",
        "01.11.": "Allerheiligen",
        "25.12.": "1. Weihnachtsfeiertag",
        "26.12.": "2. Weihnachtsfeiertag"
    };

    // Moveable feasts per year (Bavaria)
    const moveableFeastsByYear = {
        2026: {
            "03.04.": "Karfreitag",
            "06.04.": "Ostermontag",
            "14.05.": "Christi Himmelfahrt",
            "25.05.": "Pfingstmontag",
            "04.06.": "Fronleichnam",
        },
        2027: {
            "26.03.": "Karfreitag",
            "29.03.": "Ostermontag",
            "06.05.": "Christi Himmelfahrt",
            "17.05.": "Pfingstmontag",
            "27.05.": "Fronleichnam",
        }
    };

    const match = fixedHolidays[dateStr] || (moveableFeastsByYear[year] && moveableFeastsByYear[year][dateStr]);
    if (match) return match;

    // Date ranges (vacations, congresses)
    const ranges = [
        { start: '2026-08-03', end: '2026-09-14', label: 'Sommerferien' },
        { start: '2026-12-24', end: '2027-01-08', label: 'Weihnachtsferien' },
        { start: '2026-04-08', end: '2026-04-11', label: 'DGK Kongress' },
        { start: '2026-08-27', end: '2026-08-31', label: 'ESC Kongress' },
    ];

    for (const range of ranges) {
        if (time >= new Date(range.start).getTime() && time <= new Date(range.end).getTime()) {
            return range.label;
        }
    }

    return null;
}
window.toggleErsatztermin = function (index, isChecked) {
    currentSchedule[index].isNachholtermin = isChecked;
    hasUnsavedChanges = true;
    renderSchedule();
}
window.toggleForgotten = function (index, isChecked) {
    const slot = currentSchedule[index];
    slot.forgotten = isChecked;
    hasUnsavedChanges = true;

    if (isChecked) {
        // Find next free slot
        const oldDate = new Date(slot.date).toLocaleDateString('de-DE');
        const presenter = slot.presenter;
        let found = false;

        // Determine target day based on role
        let targetDay = 1; // Default: Monday (Assistenzarzt)
        if (currentEmployees) {
            const emp = currentEmployees.find(e => e.name === presenter);
            if (emp && emp.isOberarzt) {
                targetDay = 3; // Wednesday (Oberarzt)
            }
        }

        for (let i = index + 1; i < currentSchedule.length; i++) {
            const potential = currentSchedule[i];
            const pDate = new Date(potential.date);

            // Must be empty, not a holiday, AND match the target day
            if ((!potential.presenter || potential.presenter === "") &&
                !checkHoliday(pDate) &&
                pDate.getDay() === targetDay) {

                potential.presenter = presenter;
                potential.topic = "Ersatztermin";
                potential.isNachholtermin = true; // Mark as Ersatztermin
                found = true;
                alert(`${presenter} wurde automatisch auf den ${pDate.toLocaleDateString('de-DE')} verschoben.`);
                break;
            }
        }

        if (!found) {
            alert(`Warnung: Kein freier ${targetDay === 3 ? "Mittwoch" : "Montag"} für die Verschiebung gefunden!`);
        }
    }

    renderSchedule();
}
function renderEmployees() {
    const table = document.getElementById('employee-table');
    const tbody = document.getElementById('employee-body');
    if (!tbody || !table) return;

    // Make table visible
    table.classList.remove('hidden');

    // Sort employees using helper
    currentEmployees.sort(sortEmployeesByName);

    tbody.innerHTML = '';

    currentEmployees.forEach((emp, index) => {
        const row = document.createElement('tr');

        let idCell = emp.id || '';
        let nameCell = emp.name;
        let emailCell = emp.email;
        let oaCell = emp.isOberarzt ? "Ja" : "Nein";
        let activeCell = emp.active ? "Ja" : "Nein";
        let actionCell = "";

        if (isAdmin) {
            idCell = `<input class="edit-field" value="${emp.id || ''}" onchange="updateEmployee(${index}, 'id', this.value)" style="width: 90px;">`;
            nameCell = `<input class="edit-field" value="${emp.name || ''}" onchange="updateEmployee(${index}, 'name', this.value)">`;
            emailCell = `<input class="edit-field" value="${emp.email || ''}" onchange="updateEmployee(${index}, 'email', this.value)">`;
            oaCell = `<input type="checkbox" ${emp.isOberarzt ? 'checked' : ''} onchange="updateEmployee(${index}, 'isOberarzt', this.checked)">`;
            const activeTooltip = "Die Checkbox blendet Mitarbeiter temporär aus, die aktuell keine Fortbildungen übernehmen (z. B. durch Rotationen in andere Abteilungen oder längere Abwesenheit)";
            activeCell = `<span class="custom-tooltip" data-tooltip="${activeTooltip}"><input type="checkbox" ${emp.active ? 'checked' : ''} onchange="updateEmployee(${index}, 'active', this.checked)"></span>`;
            actionCell = `<button class="delete-btn" onclick="deleteEmployee(${index})">Löschen</button>`;
        }

        row.innerHTML = `
            <td>${idCell}</td>
            <td>${nameCell}</td>
            <td>${emailCell}</td>
            <td>${oaCell}</td>
            <td>${activeCell}</td>
            <td class="admin-col ${isAdmin ? '' : 'hidden'}">${actionCell}</td>
        `;
        tbody.appendChild(row);
    });

    updateAdminUI();
}

function updateAdminUI() {
    document.querySelectorAll('.admin-col').forEach(el => {
        if (isAdmin) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    const addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
        if (isAdmin) addBtn.classList.remove('hidden');
        else addBtn.classList.add('hidden');
    }

    // Toggle Employee Tab Visibility
    const employeeTabBtn = document.querySelector('button[data-tab="employees"]');
    if (employeeTabBtn) {
        if (isAdmin) employeeTabBtn.classList.remove('hidden');
        else employeeTabBtn.classList.add('hidden');
    }

    // Toggle Bulk Import Section
    const bulkImportSection = document.getElementById('bulk-import-section');
    if (bulkImportSection) {
        if (isAdmin) bulkImportSection.classList.remove('hidden');
        else bulkImportSection.classList.add('hidden');
    }

    // Toggle Distribution Tab Button
    const distributionTabBtn = document.querySelector('button[data-tab="distribution"]');
    if (distributionTabBtn) {
        if (isAdmin) distributionTabBtn.classList.remove('hidden');
        else distributionTabBtn.classList.add('hidden');
    }
}

window.parseEmployeeInput = function () {
    const textarea = document.getElementById('bulk-import-text');
    if (!textarea) return;

    const text = textarea.value;
    if (!text.trim()) {
        alert("Bitte Text eingeben.");
        return;
    }

    const lines = text.split('\n');
    let addedCount = 0;

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        // Try to extract email
        // Simple regex for email: something@something.something
        const emailMatch = line.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
        let email = "@";
        let name = line;

        if (emailMatch) {
            email = emailMatch[0];
            // Remove email from line to get name
            name = line.replace(email, "").trim();
            // Clean up name (remove potential brackets/parentheses around email if they were not part of the match)
            name = name.replace(/[<>()\[\]]/g, "").trim();

            // If name is empty, try to derive from email (format: firstname.lastname@...)
            if (!name && email.includes('@')) {
                const localPart = email.split('@')[0];
                if (localPart.includes('.')) {
                    name = localPart.split('.').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
                } else {
                    name = localPart.charAt(0).toUpperCase() + localPart.slice(1);
                }
            }
        }

        if (name) {
            currentEmployees.push({ name: name, email: email, active: true });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        hasUnsavedChanges = true;
        renderEmployees();
        renderSchedule(); // Update dropdowns
        alert(`${addedCount} Mitarbeiter hinzugefügt.\nBitte "Speichern" nicht vergessen!`);
        textarea.value = ""; // Clear input
    } else {
        alert("Keine gültigen Daten gefunden.");
    }
}

// --- Updates (Memory) ---

window.updateSlot = function (index, field, value) {
    currentSchedule[index][field] = value;
    hasUnsavedChanges = true;
    if (field === 'presenter') renderSchedule(); // Re-calc stats immediately
}

window.updateEmployee = function (index, field, value) {
    currentEmployees[index][field] = value;
    hasUnsavedChanges = true;
    // If name or active status changes, we must re-render the schedule dropdowns
    if (field === 'name' || field === 'active') {
        renderSchedule();
    }
}

window.addEmployee = function () {
    if (!currentEmployees) currentEmployees = [];
    currentEmployees.push({ id: "", name: "Neu", email: "@", active: true, isOberarzt: false });
    hasUnsavedChanges = true;
    renderEmployees();
    renderSchedule(); // Update dropdowns immediately
}

window.deleteEmployee = function (index) {
    if (confirm("Mitarbeiter wirklich löschen?")) {
        currentEmployees.splice(index, 1);
        hasUnsavedChanges = true;
        renderEmployees();
        renderSchedule(); // Update dropdowns immediately
    }
}

// --- Tabs ---

function setupTabs() {
    window.switchTab = function (tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

        // Find active button - compatibility with both structures
        let activeBtn = document.querySelector(`button[data-tab="${tabName}"]`);
        if (!activeBtn) activeBtn = document.querySelector(`button[onclick="switchTab('${tabName}')"]`);

        if (activeBtn) activeBtn.classList.add('active');

        const activeContent = document.getElementById(`tab-${tabName}`);
        if (activeContent) activeContent.classList.remove('hidden');
    };
}

// --- Auth & Persistence ---

window.showLogin = function () { document.getElementById('login-modal').classList.remove('hidden'); }
window.hideLogin = function () {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('password-input').value = '';
}

// Old password check removed

window.checkLogin = async function () {
    const input = document.getElementById('password-input').value.trim();
    if (!input) return;

    // Test the key by trying to fetch the schedule
    const originalText = document.querySelector('#login-box button:first-of-type').textContent;
    document.querySelector('#login-box button:first-of-type').textContent = "Prüfe...";

    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${SCHEDULE_BIN_ID}/latest`, {
            headers: { "X-Master-Key": input }
        });

        if (response.ok) {
            // Success!
            apiKey = input;
            isAdmin = true;
            localStorage.setItem('journal_api_key', apiKey); // Persist

            document.getElementById('login-btn').classList.add('hidden');
            const adminPanel = document.getElementById('admin-panel');
            if (adminPanel) adminPanel.classList.remove('hidden');
            hideLogin();

            // Reload data with new key
            await loadSchedule();
            await loadEmployees();
            await loadDistribution();
            renderSchedule();
            renderEmployees();
            renderDistribution();
            updateAdminUI();

            // Update Print Header "Stand" date
            const standDateEl = document.getElementById('print-stand-date');
            if (standDateEl) {
                const now = new Date();
                standDateEl.textContent = "Stand: " + now.toLocaleDateString('de-DE');
            }
        } else {
            throw new Error("Ungültiger Key");
        }
    } catch (e) {
        const err = document.getElementById('login-error');
        if (err) {
            err.textContent = "Ungültiger Master Key!";
            err.style.display = 'block';
        }
    } finally {
        document.querySelector('#login-box button:first-of-type').textContent = originalText;
    }
}

window.logout = function () {
    isAdmin = false;
    apiKey = null;
    localStorage.removeItem('journal_api_key'); // Clear

    location.reload(); // Reload to reset state (simplest way to clear data from memory)
}
window.handleSwap = function (sourceIndex, targetName) {
    if (!targetName) return;

    const sourceSlot = currentSchedule[sourceIndex];
    const sourceName = sourceSlot.presenter; // Might be empty
    const today = new Date().toISOString().split('T')[0];

    // Find all non-holiday slots assigned to targetName
    const allTargetSlots = currentSchedule.map((slot, idx) => ({ slot, idx }))
        .filter(({ slot }) => slot.presenter === targetName && !checkHoliday(new Date(slot.date)));

    if (allTargetSlots.length === 0) {
        // Case 1: No target slots -> Replacement
        if (confirm(`'${targetName}' hat keine eigenen Termine.\nSoll er/sie diesen Termin (${sourceSlot.date}) übernehmen?`)) {
            sourceSlot.presenter = targetName;
            sourceSlot.forgotten = false;
            saveSchedule();
            renderSchedule();
        } else {
            renderSchedule(); // Reset dropdown
        }
    } else if (allTargetSlots.length === 1) {
        // Case 2: Exactly one target slot -> Simple Swap
        const targetIndex = allTargetSlots[0].idx;
        const targetSlot = currentSchedule[targetIndex];
        if (confirm(`Tausch bestätigen:\n\n${sourceName || "Leer"} (${sourceSlot.date})\n↔\n${targetName} (${targetSlot.date})`)) {
            executeSwap(sourceIndex, targetIndex);
        } else {
            renderSchedule();
        }
    } else {
        // Case 3: Multiple target slots -> Show Selection Modal
        openSwapSelectionModal(sourceIndex, targetName, allTargetSlots);
    }
};

window.openSwapSelectionModal = function (sourceIndex, targetName, targetSlots) {
    const modal = document.getElementById('swap-selection-modal');
    const title = document.getElementById('swap-modal-title');
    const desc = document.getElementById('swap-modal-desc');
    const list = document.getElementById('swap-options-list');
    const sourceSlot = currentSchedule[sourceIndex];

    title.textContent = `Tausch mit ${targetName}`;
    desc.textContent = `Wähle den Termin von ${targetName}, der mit dem Termin am ${sourceSlot.date} getauscht werden soll:`;
    list.innerHTML = '';

    targetSlots.forEach(({ slot, idx }) => {
        const btn = document.createElement('button');
        btn.className = 'edit-btn';
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.marginBottom = '10px';
        btn.style.textAlign = 'left';
        btn.style.background = '#f8f9fa';
        btn.style.color = '#333';
        btn.style.border = '1px solid #ddd';
        btn.style.padding = '10px';

        const dateStr = new Date(slot.date).toLocaleDateString('de-DE');
        btn.innerHTML = `<strong>${dateStr}</strong><br><small>${slot.topic || "(Kein Thema)"}</small>`;

        btn.onclick = () => {
            executeSwap(sourceIndex, idx);
            closeSwapSelectionModal();
        };
        list.appendChild(btn);
    });

    modal.classList.remove('hidden');
}

window.closeSwapSelectionModal = function () {
    const modal = document.getElementById('swap-selection-modal');
    if (modal) modal.classList.add('hidden');
    renderSchedule(); // Reset dropdowns
}

window.executeSwap = function (sourceIndex, targetIndex) {
    const sourceSlot = currentSchedule[sourceIndex];
    const targetSlot = currentSchedule[targetIndex];

    const sourceName = sourceSlot.presenter;
    const targetName = targetSlot.presenter;

    sourceSlot.presenter = targetName;
    targetSlot.presenter = sourceName;

    sourceSlot.forgotten = false;
    targetSlot.forgotten = false;

    hasUnsavedChanges = true;
    saveSchedule();
    renderSchedule();
}

// Start Helper: sortEmployeesByName
function sortEmployeesByName(a, b) {
    const nameA = a.name.trim();
    const nameB = b.name.trim();

    // Extract last name (last word)
    const partsA = nameA.split(' ');
    const lastNameA = partsA[partsA.length - 1].toLowerCase();

    const partsB = nameB.split(' ');
    const lastNameB = partsB[partsB.length - 1].toLowerCase();

    if (lastNameA < lastNameB) return -1;
    if (lastNameA > lastNameB) return 1;

    // If last names match, fallback to full name
    return nameA.localeCompare(nameB);
}
// End Helper

// --- Distribution Helper ---
function isEmployeeExcluded(employeeId, dateObj) {
    if (!employeeId || !currentDistribution || !Array.isArray(currentDistribution)) return false;

    // Normalise date to YYYY_MM
    const year = dateObj.getFullYear();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const miMatch = `${year}_${month}`;

    const exclusions = ["93", "elternzeit", "donaustauf", "kelheim", "med1", "med3"];

    // Find entries for this employee ID in this month
    const entries = currentDistribution.filter(d => d.ei === employeeId && d.mi === miMatch);

    // Check if any entry matches the exclusion criteria
    return entries.some(d => {
        if (!d.bi) return false;
        const area = d.bi.toLowerCase();
        return exclusions.some(ex => area.includes(ex));
    });
}

window.autoDistribute = function () {
    if (!currentSchedule || !currentEmployees) return;
    if (!confirm("Automatische Verteilung starten?\n\n- Montags: Assistenzärzte\n- Mittwochs: Oberärzte\n- Alphabetisch fortlaufend ab letztem Eintrag.\n\nNur leere Slots bis zum Ende des NÄCHSTEN Quartals werden gefüllt.\nACHTUNG: Alle Termine NACH dem nächsten Quartal werden gelöscht!")) return;

    const todayDate = new Date();
    const todayStr = todayDate.toISOString().split('T')[0];

    // Filter active employees
    const activeEmployees = currentEmployees.filter(e => e.active);
    const oaList = activeEmployees.filter(e => e.isOberarzt).sort(sortEmployeesByName);
    const assistList = activeEmployees.filter(e => !e.isOberarzt).sort(sortEmployeesByName);

    if (oaList.length === 0 && assistList.length === 0) {
        alert("Keine aktiven Mitarbeiter gefunden.");
        return;
    }

    // 2. Find last assigned indices
    let lastOAName = null;
    let lastAssistName = null;

    // We only look for the last assignments UP TO today to determine where to start the sequence.
    // This prevents future manual entries from "pulling" the sequence too far ahead.

    for (let i = currentSchedule.length - 1; i >= 0; i--) {
        const slot = currentSchedule[i];
        if (slot.date <= todayStr && slot.presenter && slot.presenter.trim() !== "" && !slot.isNachholtermin) {
            const trimmedPresenter = slot.presenter.trim();
            if (!lastOAName && oaList.find(e => e.name.trim() === trimmedPresenter)) {
                lastOAName = trimmedPresenter;
            }
            if (!lastAssistName && assistList.find(e => e.name.trim() === trimmedPresenter)) {
                lastAssistName = trimmedPresenter;
            }
        }
        if (lastOAName && lastAssistName) break;
    }

    let nextOAIndex = 0;
    if (lastOAName) {
        const idx = oaList.findIndex(e => e.name.trim() === lastOAName);
        if (idx !== -1) nextOAIndex = (idx + 1) % oaList.length;
    }

    let nextAssistIndex = 0;
    if (lastAssistName) {
        const idx = assistList.findIndex(e => e.name.trim() === lastAssistName);
        if (idx !== -1) nextAssistIndex = (idx + 1) % assistList.length;
    }

    // Determine End of Current Quarter (Fixed Logic)
    // ... (rest of the date logic remains same)
    const currentMonth = todayDate.getMonth();
    const currentYearFixed = todayDate.getFullYear();
    let qEndMonth;
    if (currentMonth <= 2) qEndMonth = 2;
    else if (currentMonth <= 5) qEndMonth = 5;
    else if (currentMonth <= 8) qEndMonth = 8;
    else qEndMonth = 11;
    let nextQEndMonth = qEndMonth + 3;
    let finalYear = currentYearFixed;
    if (nextQEndMonth > 11) {
        nextQEndMonth -= 12;
        finalYear += 1;
    }
    const limitDate = new Date(finalYear, nextQEndMonth + 1, 0, 23, 59, 59);

    // 3. Distribute
    let filledCount = 0;
    let clearedCount = 0;

    currentSchedule.forEach(slot => {
        const slotDateStr = slot.date;
        const slotDateObj = new Date(slotDateStr);

        if (slotDateStr >= todayStr) {
            if (slotDateObj <= limitDate) {
                if (checkHoliday(slotDateObj)) return;

                const day = slotDateObj.getDay();
                const isManual = (slot.presenter && slot.presenter.trim() !== "");

                if (day === 1 && assistList.length > 0) {
                    // Monday -> Assistenzarzt
                    if (!isManual) {
                        // Find next available assistent who is NOT busy
                        let foundAvailable = false;
                        let startIndex = nextAssistIndex;
                        let loopCount = 0;

                        while (loopCount < assistList.length) {
                            const candidate = assistList[nextAssistIndex];
                            if (!isEmployeeExcluded(candidate.id, slotDateObj)) {
                                slot.presenter = candidate.name;
                                filledCount++;
                                foundAvailable = true;
                                break;
                            }
                            // Move to next candidate
                            nextAssistIndex = (nextAssistIndex + 1) % assistList.length;
                            loopCount++;
                        }

                        if (!foundAvailable) {
                            console.warn(`Kein verfügbarer Assistenzarzt für den ${slotDateStr} gefunden (alle busy).`);
                            // Slot remains empty
                        }
                    } else if (!slot.isNachholtermin) {
                        // If manually filled (and not a catch-up), sync the sequence
                        const mIdx = assistList.findIndex(e => e.name.trim() === slot.presenter.trim());
                        if (mIdx !== -1) nextAssistIndex = (mIdx + 1) % assistList.length;
                        return; // Done with this slot
                    }
                    if (!slot.isNachholtermin || !isManual) {
                        nextAssistIndex = (nextAssistIndex + 1) % assistList.length;
                    }
                } else if (day === 3 && oaList.length > 0) {
                    // Wednesday -> Oberarzt
                    if (!isManual) {
                        // Find next available OA who is NOT busy
                        let foundAvailable = false;
                        let startIndex = nextOAIndex;
                        let loopCount = 0;

                        while (loopCount < oaList.length) {
                            const candidate = oaList[nextOAIndex];
                            if (!isEmployeeExcluded(candidate.id, slotDateObj)) {
                                slot.presenter = candidate.name;
                                filledCount++;
                                foundAvailable = true;
                                break;
                            }
                            // Move to next candidate
                            nextOAIndex = (nextOAIndex + 1) % oaList.length;
                            loopCount++;
                        }

                        if (!foundAvailable) {
                            console.warn(`Kein verfügbarer Oberarzt für den ${slotDateStr} gefunden (alle busy).`);
                        }
                    } else if (!slot.isNachholtermin) {
                        // Sync sequence for manual entries
                        const mIdx = oaList.findIndex(e => e.name.trim() === slot.presenter.trim());
                        if (mIdx !== -1) nextOAIndex = (mIdx + 1) % oaList.length;
                        return;
                    }
                    if (!slot.isNachholtermin || !isManual) {
                        nextOAIndex = (nextOAIndex + 1) % oaList.length;
                    }
                }
            } else {
                // Clear Logic for Future Quarters
                if (slot.presenter !== "" || slot.topic !== "" || slot.forgotten) {
                    slot.presenter = "";
                    slot.topic = "";
                    slot.forgotten = false;
                    clearedCount++;
                }
            }
        }
    });

    if (filledCount > 0 || clearedCount > 0) hasUnsavedChanges = true;
    renderSchedule();

    if (filledCount > 0 || clearedCount > 0) {
        alert(`${filledCount} Termine verteilt.\n${clearedCount} Termine nach dem nächsten Quartal gelöscht.\nBitte "Speichern" nicht vergessen!`);
    } else {
        alert("Keine Änderungen (Zeitraum voll oder keine Mitarbeiter).");
    }
};

window.clearFutureQuarters = function () {
    if (!currentSchedule) return;

    // Determine End of Current Quarter
    const todayDate = new Date();
    const currentMonth = todayDate.getMonth(); // 0-11
    const currentYear = todayDate.getFullYear();

    // Quarter mapping:
    let endMonth, endDay;
    if (currentMonth <= 2) { endMonth = 2; endDay = 31; }      // Q1: March
    else if (currentMonth <= 5) { endMonth = 5; endDay = 30; } // Q2: June
    else if (currentMonth <= 8) { endMonth = 8; endDay = 30; } // Q3: Sept
    else { endMonth = 11; endDay = 31; }                       // Q4: Dec

    const quarterEndDate = new Date(currentYear, endMonth, endDay, 23, 59, 59);
    const limitDateStr = quarterEndDate.toLocaleDateString('de-DE');

    if (!confirm(`WARNUNG: Alle Termine AB dem nächsten Quartal (nach dem ${limitDateStr}) werden unwiderruflich gelöscht!\n\nFortfahren?`)) return;

    let clearedCount = 0;
    const todayStr = todayDate.toISOString().split('T')[0];

    currentSchedule.forEach(slot => {
        const slotDateStr = slot.date;
        const slotDateObj = new Date(slotDateStr);

        // Clear if date is in future AND after current quarter end
        if (slotDateStr >= todayStr && slotDateObj > quarterEndDate) {
            if (slot.presenter !== "" || slot.topic !== "" || slot.forgotten) {
                slot.presenter = "";
                slot.topic = "";
                slot.forgotten = false;
                clearedCount++;
            }
        }
    });

    if (clearedCount > 0) {
        renderSchedule();
        alert(`${clearedCount} Termine gelöscht.\nBitte "Speichern" nicht vergessen!`);
    } else {
        alert("Keine Termine im gewählten Zeitraum gefunden.");
    }
};



// --- Print Filter ---

window.showPrintModal = function () {
    const modal = document.getElementById('print-modal');
    if (modal) {
        modal.classList.remove('hidden');

        // Set default dates if empty
        const startInput = document.getElementById('print-start');
        const endInput = document.getElementById('print-end');

        if (startInput && !startInput.value) {
            startInput.value = new Date().toISOString().split('T')[0];
        }
    }
}

window.closePrintModal = function () {
    const modal = document.getElementById('print-modal');
    if (modal) modal.classList.add('hidden');
}

window.confirmPrint = function () {
    const startVal = document.getElementById('print-start').value;
    const endVal = document.getElementById('print-end').value;

    if (!startVal) {
        alert("Bitte Startdatum wählen.");
        return;
    }

    // Convert strings to comparable integers YYYYMMDD
    const startInt = parseInt(startVal.replace(/-/g, ''), 10);
    const endInt = endVal ? parseInt(endVal.replace(/-/g, ''), 10) : null;

    // 1. Hide unwanted rows
    const rows = document.querySelectorAll('#schedule-body tr');
    rows.forEach(row => {
        const dateCell = row.cells[0]; // First cell is date
        if (dateCell) {
            // German Date format DD.MM.YYYY
            const parts = dateCell.textContent.trim().split('.');
            if (parts.length === 3) {
                // Reassemble to YYYYMMDD
                // Reassemble to YYYYMMDD (with padding)
                const dPadded = parts[0].padStart(2, '0');
                const mPadded = parts[1].padStart(2, '0');
                const yPadded = parts[2];
                const rowInt = parseInt(`${yPadded}${mPadded}${dPadded}`, 10);

                let hide = false;
                if (rowInt < startInt) hide = true;
                if (endInt && rowInt > endInt) hide = true;

                if (hide) {
                    row.classList.add('print-hidden');
                } else {
                    row.classList.remove('print-hidden');
                }
            }
        }
    });

    // 2. Hide modal
    closePrintModal();

    // 3. Print
    // Small delay to ensure browser register DOM changes before snapshot
    setTimeout(() => {
        window.print();

        // 4. Restore rows after print (delayed to allow dialog to open)
        setTimeout(() => {
            rows.forEach(row => row.classList.remove('print-hidden'));
        }, 1000);
    }, 100);
}

window.saveSchedule = async function () {
    const btn = document.querySelector('.save-btn');
    const originalText = btn.textContent;
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        await saveData(SCHEDULE_BIN_ID, currentSchedule);
        await saveData(EMPLOYEES_BIN_ID, currentEmployees);
        hasUnsavedChanges = false;
        alert("Alle Änderungen gespeichert!");
    } catch (e) {
        alert("Fehler beim Speichern: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function saveData(binId, data) {
    if (!apiKey) throw new Error("Nicht eingeloggt (Key fehlt).");

    const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: 'PUT',
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": apiKey
        },
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error("Update fehlgeschlagen für Bin " + binId);
}
