// JSONBin Bins for Distribution (Shared with Urlaubsplaner V2)
const DISTRIBUTION_BIN_ID = "699c40edae596e708f42284d";

let currentSchedule = [];
let currentEmployees = [];
let currentDistribution = [];
let isAdmin = false;
let masterKey = null; // Renamed from apiKey to avoid confusion
let hasUnsavedChanges = false;
let isLoggedIn = false;

window.setUnsavedChanges = function(val) {
    hasUnsavedChanges = val;
    const container = document.getElementById("floating-save-container");
    if (container && isAdmin) {
        if (val) container.classList.remove("hidden");
        else container.classList.add("hidden");
    }
};
let showPast = false;

window.toggleShowPast = function (val) {
    showPast = val;
    renderSchedule();
}

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

    // Save/Logout
    document.querySelectorAll('.save-btn').forEach(btn => btn.addEventListener('click', saveSchedule));

    const logoutBtn = document.querySelector('#logout-btn'); // Logout
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Print Button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) printBtn.addEventListener('click', () => showPrintModal());
}

// --- Initialization ---

async function init() {
    console.log("App initializing...");
    setupEventListeners(); // Bind events first

    await loadEmployees(); // Always load employees for login modal

    // Check local storage for key
    const storedKey = localStorage.getItem('journal_api_key');
    const storedRole = localStorage.getItem('journal_user_role');
    if (storedKey) {
        masterKey = storedKey;
        isLoggedIn = true;
        // Legacy fallback: if there's a key but no role, it must be an admin from before the update
        userRole = storedRole || 'admin';
        isAdmin = userRole.includes('admin') || userRole.includes('administrator') || userRole.includes('sekretariat');
        
        const mainTabs = document.getElementById('main-tabs');
        if (mainTabs) mainTabs.classList.remove('hidden');

        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel && isAdmin) {
            adminPanel.classList.remove('hidden');
        }
    } else {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('error-message').classList.remove('hidden');
    }

    setupTabs();

    // Load all data in parallel for speed
    await Promise.all([
        loadSchedule(),
        loadDistribution()
    ]);

    // Ensure UI reflects admin state AFTER loading
    updateAdminUI();
}

document.addEventListener('DOMContentLoaded', init);

// --- Data Loading (Firestore) ---

async function loadSchedule() {
    try {
        const docSnap = await db.collection('up_config').doc('jw_schedule').get();
        if (docSnap.exists) {
            currentSchedule = docSnap.data().data || [];
        } else {
            console.warn("No schedule found in Firestore.");
            currentSchedule = [];
        }
        renderSchedule();
    } catch (e) {
        showError("Fehler beim Laden des Plans: " + e.message);
    }
}

async function loadEmployees() {
    try {
        const docSnap = await db.collection('up_config').doc('main').get();
        if (docSnap.exists) {
            const data = docSnap.data();
            currentEmployees = data.employees || data.mitarbeiter || [];
            
            currentEmployees = currentEmployees.map(emp => {
            const isOA = emp.role === 'Oberarzt' || emp.role === 'FOA' || emp.role === 'Funktionsoberarzt' || emp.isOberarzt === true;
            const isSek = String(emp.name || "").toLowerCase().includes('sekretariat') || String(emp.role || "").toLowerCase().includes('sekretariat');
            
            return {
                ...emp,
                jw_active: emp.jw_active !== false, 
                isOberarzt: isOA && !isSek
            };
        });

        console.log("Mitarbeiter erfolgreich geladen:");
        console.table(currentEmployees.map(e => ({ name: e.name, role: e.role || e.rolle, active: e.jw_active })));

    } else {
            console.warn("No employee config found in Firestore.");
            currentEmployees = [];
        }
        syncEmployeeIDs();
        renderEmployees();
        renderSchedule(); // Re-render schedule to populate dropdowns
    } catch (e) {
        console.warn("Fehler beim Laden der Mitarbeiter:", e);
        currentEmployees = [];
        renderEmployees();
    }
}

async function loadDistribution() {
    try {
        const docSnap = await db.collection('up_config').doc('main').get();
        if (docSnap.exists && docSnap.data().distribution) {
            currentDistribution = docSnap.data().distribution;
        } else if (masterKey) {
            try {
                const response = await fetch(`https://api.jsonbin.io/v3/b/${DISTRIBUTION_BIN_ID}/latest`, {
                    headers: { "X-Master-Key": masterKey }
                });
                if (response.ok) {
                    const data = await response.json();
                    currentDistribution = data.record || [];
                }
            } catch (e) {
                console.warn("Distribution JSONBin fetch failed (CORS/Network block).", e);
            }
        }
        syncEmployeeIDs();
        renderDistribution();
    } catch (e) {
        console.warn("Fehler beim Laden der Verteilung:", e);
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
    if (!isLoggedIn) return;
    const tbody = document.getElementById('schedule-body');
    // Update UI visibility
    const table = document.getElementById('schedule-table');
    const controls = document.getElementById('schedule-controls');
    if (table) table.classList.remove('hidden');
    if (controls) {
        controls.classList.remove('hidden');
        controls.style.display = 'flex';
    }
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
    const swappedStats = {};

    currentSchedule.forEach(s => {
        // Only count frequency if assigned AND NOT forgotten AND NOT holiday
        if (s.presenter && s.presenter !== "" && !checkHoliday(new Date(s.date))) {
            if (!s.forgotten) {
                stats[s.presenter] = (stats[s.presenter] || 0) + 1;
                if (s.isSwapped) {
                    swappedStats[s.presenter] = (swappedStats[s.presenter] || 0) + 1;
                }
            } else {
                forgottenStats[s.presenter] = (forgottenStats[s.presenter] || 0) + 1;
            }
        }
    });

    currentSchedule.forEach((slot, index) => {
        const dateObj = new Date(slot.date);
        const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });

        const row = document.createElement('tr');
        if (slot.date < today) {
            row.classList.add('past-row');
            if (!showPast) row.classList.add('past-hidden');
        }
        // Check for Holiday / Vacation
        const holidayName = checkHoliday(dateObj);

        let presenterCell = slot.presenter || '<span style="color:#cbd5e1">Frei</span>';
        let topicCell = slot.topic || '';
        let isHoliday = false;
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
            const sCount = (slot.presenter && swappedStats[slot.presenter]) ? swappedStats[slot.presenter] : 0;

            const fCountDisplay = fCount > 0 ? `<span style="color:var(--danger); font-weight:800;">${fCount}</span>` : "0";
            combinedStatsCell = `✅ ${count} | ❌ ${fCountDisplay} | 🔄 ${sCount}`;

            // Forgotten Checkbox
            if (isAdmin && slot.presenter) {
                const checked = slot.forgotten ? 'checked' : '';
                forgottenCell = `<input type="checkbox" ${checked} onchange="toggleForgotten(${index}, this.checked)">`;
            } else {
                forgottenCell = slot.forgotten ? "❌" : "";
            }

            if (slot.forgotten) row.classList.add('forgotten-row');

            // Ersatztermin Logic
            if (isAdmin) {
                const checked = slot.isNachholtermin ? 'checked' : '';
                ersatzCell = `<input type="checkbox" ${checked} onchange="toggleErsatztermin(${index}, this.checked)">`;
            } else {
                ersatzCell = slot.isNachholtermin ? "✅" : "";
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
                presenterCell = `<span style="text-decoration: line-through; color: var(--text-muted); font-weight: 700;">${slot.presenter}</span>`;
            } else {
                const day = dateObj.getDay();
                const isOberarztDay = (day === 3);

                let options = `<option value="">-- Wähle Referent --</option>`;
                if (currentEmployees && Array.isArray(currentEmployees)) {
                    const sortedEmps = [...currentEmployees].sort(sortEmployeesByName);
                    sortedEmps.forEach(emp => {
                        if (emp.jw_active) {
                            if (!!emp.isOberarzt === isOberarztDay || slot.presenter === emp.name) {
                                const selected = (slot.presenter === emp.name) ? 'selected' : '';
                                options += `<option value="${emp.name}" ${selected}>${emp.name}</option>`;
                            }
                        }
                    });
                }
                if (slot.presenter && (!currentEmployees || !currentEmployees.find(e => e.name === slot.presenter && e.jw_active))) {
                    options += `<option value="${slot.presenter}" selected>${slot.presenter} (Archiv)</option>`;
                }

                presenterCell = `
                    <select class="edit-field" onchange="updateSlot(${index}, 'presenter', this.value)">${options}</select>
                    <span class="print-only-value" style="display:none;">${slot.presenter || ''}</span>
                `;
            }
            topicCell = `
                <input class="edit-field" value="${slot.topic || ''}" onchange="updateSlot(${index}, 'topic', this.value)" placeholder="Thema">
                <span class="print-only-value" style="display:none;">${slot.topic || ''}</span>
            `;
        }

        row.innerHTML = `
            <td style="font-weight:600;">${dateObj.toLocaleDateString('de-DE')}</td>
            <td style="color:var(--text-muted); font-size:0.85rem;">${dayName}</td>
            <td style="font-weight:500;">${presenterCell}</td>
            <td class="center-text stats-tooltip" data-tooltip="Gehalten / Vergessen">${combinedStatsCell}</td>
            <td class="center-text">${forgottenCell}</td>
            <td class="center-text">${ersatzCell}</td>
            <td class="center-text">
                ${isAdmin ? (() => {
                if (slot.forgotten) return '-';

                let isOberarztSlot = false;
                const day = dateObj.getDay();

                if (slot.presenter && slot.presenter !== "") {
                    const assignedEmp = currentEmployees.find(e => e.name === slot.presenter);
                    if (assignedEmp) isOberarztSlot = !!assignedEmp.isOberarzt;
                } else {
                    if (day === 3) isOberarztSlot = true;
                }

                const swapOptions = [...currentEmployees]
                    .filter(e => {
                        const hasAppointments = (stats[e.name] || 0) + (forgottenStats[e.name] || 0) > 0;
                        return e.jw_active && e.name !== slot.presenter && !!e.isOberarzt === isOberarztSlot && hasAppointments;
                    })
                    .sort(sortEmployeesByName)
                    .map(e => `<option value="${e.name}">${e.name}</option>`)
                    .join('');

                return `<select class="edit-field swap-select" onchange="handleSwap(${index}, this.value)">
                        <option value="">🔄 Tausch</option>
                        ${swapOptions}
                    </select>`;
            })() : '-'}
            </td>
            <td>${topicCell}</td>
        `;

        if (slot.date < today) {
            row.classList.add('past-row');
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
    setUnsavedChanges(true);
    renderSchedule();
}
window.toggleForgotten = function (index, isChecked) {
    const slot = currentSchedule[index];
    slot.forgotten = isChecked;
    setUnsavedChanges(true);

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
            activeCell = `<span class="custom-tooltip" data-tooltip="${activeTooltip}"><input type="checkbox" ${emp.jw_active ? 'checked' : ''} onchange="updateEmployee(${index}, 'jw_active', this.checked)"></span>`;
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
    const isFullAdmin = isAdmin && userRole === 'admin';

    document.querySelectorAll('.admin-col').forEach(el => {
        if (isAdmin) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    const addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
        if (isFullAdmin) addBtn.classList.remove('hidden');
        else addBtn.classList.add('hidden');
    }

    // Toggle Employee Tab Visibility - For Admin and Sekretariat
    const employeeTabBtn = document.querySelector('button[data-tab="employees"]');
    if (employeeTabBtn) {
        if (isAdmin) employeeTabBtn.classList.remove('hidden');
        else employeeTabBtn.classList.add('hidden');
    }

    // Toggle Bulk Import Section
    const bulkImportSection = document.getElementById('bulk-import-section');
    if (bulkImportSection) {
        if (isFullAdmin) bulkImportSection.classList.remove('hidden');
        else bulkImportSection.classList.add('hidden');
    }

    // Toggle Distribution Tab Button
    const distributionTabBtn = document.querySelector('button[data-tab="distribution"]');
    if (distributionTabBtn) {
        if (isAdmin) distributionTabBtn.classList.remove('hidden');
        else distributionTabBtn.classList.add('hidden');
    }

    // Toggle Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        if (isLoggedIn) logoutBtn.classList.remove('hidden');
        else logoutBtn.classList.add('hidden');
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
        setUnsavedChanges(true);
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
    setUnsavedChanges(true);
    if (field === 'presenter') renderSchedule(); // Re-calc stats immediately
}

window.updateEmployee = function (index, field, value) {
    currentEmployees[index][field] = value;
    setUnsavedChanges(true);
    // If name or active status changes, we must re-render the schedule dropdowns
    if (field === 'name' || field === 'active') {
        renderSchedule();
    }
}

window.addEmployee = function () {
    if (!currentEmployees) currentEmployees = [];
    currentEmployees.push({ id: "", name: "Neu", email: "@", active: true, isOberarzt: false });
    setUnsavedChanges(true);
    renderEmployees();
    renderSchedule(); // Update dropdowns immediately
}

window.deleteEmployee = function (index) {
    if (confirm("Mitarbeiter wirklich löschen?")) {
        currentEmployees.splice(index, 1);
        setUnsavedChanges(true);
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

window.showLogin = function () {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('hidden');
    
    const searchInput = document.getElementById('login-name-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    const results = document.getElementById('login-search-results');
    if (results) results.classList.add('hidden');
}

window.filterLoginNames = function () {
    const searchInput = document.getElementById('login-name-search');
    const resultsContainer = document.getElementById('login-search-results');
    const query = searchInput.value.toLowerCase().trim();

    if (!query) {
        resultsContainer.classList.add('hidden');
        return;
    }

    // 1. Specific search for admin and Sekretariat (prioritized)
    // We ignore the 'active' status here because you must be able to log in even if inactive
    const specialNames = ['admin', 'Administrator', 'Sekretariat'];
    const specialMatches = currentEmployees.filter(emp => {
        const name = emp.name.toLowerCase();
        return (specialNames.some(sn => name.includes(sn.toLowerCase())) || name.startsWith('admin')) && name.includes(query);
    });

    // 2. Search for others who might have the role
    const otherMatches = currentEmployees.filter(emp => {
        const name = emp.name.toLowerCase();
        const isSpecial = specialNames.some(sn => name.includes(sn.toLowerCase()) || name.startsWith('admin'));
        if (isSpecial) return false; 

        const role = String(emp.role || emp.rolle || "").toLowerCase();
        return name.includes(query);
    }).sort(sortEmployeesByName);

    const allMatches = [...specialMatches, ...otherMatches];

    if (allMatches.length > 0) {
        resultsContainer.innerHTML = '';
        allMatches.forEach(emp => {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.style.padding = '10px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid #eee';
            div.textContent = emp.name;
            div.onclick = () => selectLoginName(emp);
            resultsContainer.appendChild(div);
        });
        resultsContainer.classList.remove('hidden');
    } else {
        resultsContainer.innerHTML = '<div style="padding:10px; color:var(--text-muted);">Kein Account gefunden</div>';
        resultsContainer.classList.remove('hidden');
    }
}

window.selectLoginName = function (emp) {
    document.getElementById('login-name-search').value = emp.name;
    document.getElementById('login-selected-id').value = emp.id;
    document.getElementById('login-search-results').classList.add('hidden');
}

window.hideLogin = function () {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-error').style.display = 'none';
    const pinField = document.getElementById('login-pin');
    if (pinField) pinField.value = '';
    document.getElementById('login-selected-id').value = '';
}

let userRole = null; // Store the role: 'admin' or 'sekretariat'

window.checkLogin = async function () {
    const empId = document.getElementById('login-selected-id').value;
    const pin = document.getElementById('login-pin').value.trim();
    const errorEl = document.getElementById('login-error');
    
    if (!empId || !pin) {
        errorEl.textContent = "❌ Bitte Name wählen und PIN eingeben.";
        errorEl.style.display = 'block';
        return;
    }

    const emp = currentEmployees.find(e => e.id === empId);
    if (!emp) return;

    const btn = document.querySelector('#login-modal .btn-primary');
    const originalText = btn.textContent;
    btn.textContent = "Prüfe...";
    btn.disabled = true;

    try {
        if (emp.pin && String(emp.pin) !== pin) {
            throw new Error("Falsche PIN");
        }

        const role = String(emp.role || emp.rolle || "").toLowerCase();
        const name = String(emp.name || "").toLowerCase();
        
        userRole = 'employee';
        if (role.includes('sekretariat') || name.includes('sekretariat')) userRole = 'sekretariat';
        if (role.includes('admin') || role.includes('administrator') || name.includes('admin') || name.includes('administrator')) userRole = 'admin';
        
        isAdmin = (userRole === 'admin' || userRole === 'sekretariat');
        isLoggedIn = true;
        
        const configSnap = await db.collection('up_config').doc('main').get();
        if (configSnap.exists) {
            masterKey = configSnap.data().jsonbin_key || configSnap.data().master_key;
            localStorage.setItem('journal_api_key', masterKey); 
            localStorage.setItem('journal_user_role', userRole);

            const mainTabs = document.getElementById('main-tabs');
            if (mainTabs) mainTabs.classList.remove('hidden');
        }

        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');
        hideLogin();

        await loadSchedule();
        await loadDistribution();
        renderSchedule();
        renderEmployees();
        renderDistribution();
        updateAdminUI();

        const standDateEl = document.getElementById('print-stand-date');
        if (standDateEl) {
            const now = new Date();
            standDateEl.textContent = "Stand: " + now.toLocaleDateString('de-DE');
        }
    } catch (e) {
        errorEl.textContent = "❌ Login fehlgeschlagen: " + e.message;
        errorEl.style.display = 'block';
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

window.logout = function () {
    isAdmin = false;
    masterKey = null;
    localStorage.removeItem('journal_api_key'); // Clear

    location.reload(); 
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
    
    // Add Tausch info to topics
    const sourceTopic = sourceSlot.topic || "";
    const targetTopic = targetSlot.topic || "";
    if (!sourceTopic.includes("[Tausch mit")) sourceSlot.topic = (sourceTopic + " [Tausch mit " + targetName + "]").trim();
    if (!targetTopic.includes("[Tausch mit")) targetSlot.topic = (targetTopic + " [Tausch mit " + sourceName + "]").trim();
    
    sourceSlot.isSwapped = true;
    targetSlot.isSwapped = true;

    sourceSlot.forgotten = false;
    targetSlot.forgotten = false;

    setUnsavedChanges(true);
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
    const allActive = currentEmployees.filter(e => e.jw_active ?? true);
    const oaList = allActive.filter(e => e.isOberarzt).sort(sortEmployeesByName);
    const assistList = allActive.filter(e => !e.isOberarzt).sort(sortEmployeesByName);

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

    if (filledCount > 0 || clearedCount > 0) setUnsavedChanges(true);
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
        // Temporarily show all for range filtering
        row.classList.remove('past-hidden');
        
        const dateCell = row.cells[0]; // First cell is date
        if (dateCell) {
            const parts = dateCell.textContent.trim().split('.');
            if (parts.length === 3) {
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
    setTimeout(() => {
        window.print();

        // 4. Restore rows after print
        setTimeout(() => {
            rows.forEach(row => {
                row.classList.remove('print-hidden');
                // Restore past-hidden if needed
                if (!showPast && row.classList.contains('past-row')) {
                    row.classList.add('past-hidden');
                }
            });
        }, 1000);
    }, 100);
}

window.saveSchedule = async function () {
    if (!isAdmin) return;
    const btn = document.querySelector('.save-btn');
    const originalText = btn.textContent;
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        const now = new Date().toISOString();
        
        // 1. Save Schedule
        await db.collection('up_config').doc('jw_schedule').set({
            data: currentSchedule,
            updatedAt: now
        }, { merge: true });

        // 2. Save Distribution back to JSONBin (Sync with Urlaubsplaner V2 in background)
        if (masterKey) {
            fetch(`https://api.jsonbin.io/v3/b/${DISTRIBUTION_BIN_ID}`, {
                method: 'PUT',
                headers: {
                    "Content-Type": "application/json",
                    "X-Master-Key": masterKey
                },
                body: JSON.stringify(currentDistribution)
            }).catch(e => console.warn("JSONBin background save failed:", e));
        }

        // 3. Save Employees and Distribution to Firestore (Shared with Urlaubsplaner)
        // Clean employees before saving (remove JW-only UI flags if any, though here we keep them for compatibility)
        await db.collection('up_config').doc('main').set({
            employees: currentEmployees,
            distribution: currentDistribution,
            updatedAt: now
        }, { merge: true });

        setUnsavedChanges(false);
        alert("Alle Änderungen in Firestore gespeichert!");
    } catch (e) {
        console.error("Save Error:", e);
        alert("Fehler beim Speichern: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

window.publishViaEmail = async function() {
    if (!isAdmin) return;

    if (hasUnsavedChanges) {
        alert("Bitte speichern Sie zuerst Ihre Änderungen ab (Klick auf 'Speichern'), bevor Sie den Plan per E-Mail veröffentlichen.");
        return;
    }

    // 1. Get schedule and filter future slots (date >= today and assigned appointments only)
    const todayStr = new Date().toISOString().split('T')[0];
    const futureSlots = currentSchedule.filter(slot => 
        slot.date && 
        slot.date >= todayStr && 
        slot.presenter && 
        slot.presenter.trim() !== '' && 
        slot.presenter.trim().toLowerCase() !== 'frei'
    ).sort((a, b) => a.date.localeCompare(b.date));
    
    if (futureSlots.length === 0) {
        alert("Es gibt keine zukünftigen vergebenen Termine im Plan, die per E-Mail gesendet werden könnten.");
        return;
    }

    // 2. Identify all unique presenters in the future schedule
    const uniquePresenters = [...new Set(futureSlots.map(s => s.presenter).filter(Boolean))].sort();
    
    if (uniquePresenters.length === 0) {
        alert("Es sind keine Referenten in den zukünftigen Terminen eingetragen.");
        return;
    }

    // Prepare preview helper functions
    const getEmailForPresenter = (presenterName) => {
        const emp = currentEmployees.find(e => e.name && e.name.trim() === presenterName.trim());
        const email = emp ? emp.email || emp.mitarbeiter_email : null;
        return (email && email.trim() !== '' && email.trim() !== '@') ? email.trim() : null;
    };

    const buildPreviewHtml = (presenterName) => {
        let tableRowsHtml = '';
        const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
        
        futureSlots.forEach(slot => {
            const dateObj = new Date(slot.date);
            const dayName = dayNames[dateObj.getDay()];
            const formattedDate = slot.date.split('-').reverse().join('.'); // DD.MM.YYYY
            
            const presenterText = slot.forgotten ? `<span style="text-decoration: line-through; color: #94a3b8;">${slot.presenter}</span>` : (slot.presenter || '<span style="color:#cbd5e1">Frei</span>');
            const topicText = slot.topic || '';
            const rowBg = slot.isNachholtermin ? 'background-color: #fef08a;' : '';
            
            tableRowsHtml += `
                <tr style="${rowBg}">
                    <td style="padding: 10px; border: 1px solid #cbd5e1;">${formattedDate}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1;">${dayName}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1;">${presenterText}</td>
                    <td style="padding: 10px; border: 1px solid #cbd5e1;">${topicText}</td>
                </tr>
            `;
        });
        
        const scheduleTableHtml = `
            <table style="border-collapse: collapse; width: 100%; max-width: 600px; font-family: Arial, sans-serif; font-size: 14px; margin: 15px 0; color: #1e293b;">
              <thead>
                <tr style="background-color: #0f172a; color: #ffffff; text-align: left;">
                  <th style="padding: 10px; border: 1px solid #cbd5e1;">Datum</th>
                  <th style="padding: 10px; border: 1px solid #cbd5e1;">Tag</th>
                  <th style="padding: 10px; border: 1px solid #cbd5e1;">Referent</th>
                  <th style="padding: 10px; border: 1px solid #cbd5e1;">Thema</th>
                </tr>
              </thead>
              <tbody>
                ${tableRowsHtml}
              </tbody>
            </table>
        `;
        
        return `
            <div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #334155; max-width: 600px; text-align: left;">
                <p>Hallo ${presenterName},</p>
                <p>anbei finden Sie den aktuellen Journal Watch Plan.</p>
                
                ${scheduleTableHtml}
                
                <p>Bitte Tausch und Änderungswünsche direkt an Frau Rohrmaier melden.</p>
                
                <p>Weitere Details finden Sie unter: <a href="https://lateina.github.io/journal-watch/" style="color: #0284c7; text-decoration: underline;" target="_blank">https://lateina.github.io/journal-watch/</a></p>
                
                <p style="margin-top: 30px; color: #64748b;">
                    Mit freundlichen Grüßen,<br>
                    A. Rohrmaier<br><br>
                    Astrid Rohrmaier<br>
                    Oberarzt-Sekretariat Kardiologie<br>
                    Universitätsklinikum Regensburg<br>
                    Franz-Josef-Strauß-Allee 11<br>
                    93053 Regensburg<br>
                    <a href="mailto:astrid.rohrmaier@ukr.de" style="color: #0284c7;">astrid.rohrmaier@ukr.de</a><br>
                    Tel.: 0941-9447207
                </p>
            </div>
        `;
    };

    // 3. Create the gorgeous Preview Modal
    const previewOverlay = document.createElement('div');
    previewOverlay.style.position = 'fixed';
    previewOverlay.style.top = '0';
    previewOverlay.style.left = '0';
    previewOverlay.style.width = '100vw';
    previewOverlay.style.height = '100vh';
    previewOverlay.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
    previewOverlay.style.backdropFilter = 'blur(8px)';
    previewOverlay.style.webkitBackdropFilter = 'blur(8px)';
    previewOverlay.style.display = 'flex';
    previewOverlay.style.justifyContent = 'center';
    previewOverlay.style.alignItems = 'center';
    previewOverlay.style.zIndex = '99999';
    previewOverlay.style.transition = 'opacity 0.3s ease';
    previewOverlay.style.opacity = '0';

    const previewCard = document.createElement('div');
    previewCard.style.backgroundColor = '#ffffff';
    previewCard.style.borderRadius = '1.5rem';
    previewCard.style.padding = '2rem';
    previewCard.style.width = '90%';
    previewCard.style.maxWidth = '750px';
    previewCard.style.maxHeight = '90vh';
    previewCard.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
    previewCard.style.fontFamily = "'Inter', sans-serif";
    previewCard.style.color = '#1e293b';
    previewCard.style.display = 'flex';
    previewCard.style.flexDirection = 'column';
    previewCard.style.transform = 'scale(0.9)';
    previewCard.style.transition = 'transform 0.3s ease';

    // Title
    const previewTitle = document.createElement('h3');
    previewTitle.innerText = "✉️ E-Mail-Veröffentlichung prüfen";
    previewTitle.style.fontSize = '1.4rem';
    previewTitle.style.fontWeight = '700';
    previewTitle.style.marginBottom = '1rem';
    previewTitle.style.borderBottom = '1px solid #e2e8f0';
    previewTitle.style.paddingBottom = '0.5rem';
    previewCard.appendChild(previewTitle);

    // Dropdown selection container
    const selectorContainer = document.createElement('div');
    selectorContainer.style.display = 'flex';
    selectorContainer.style.alignItems = 'center';
    selectorContainer.style.gap = '10px';
    selectorContainer.style.marginBottom = '1rem';

    const selectorLabel = document.createElement('label');
    selectorLabel.innerText = "Vorschau für Referent:";
    selectorLabel.style.fontWeight = '600';
    selectorLabel.style.fontSize = '0.9rem';

    const presenterSelect = document.createElement('select');
    presenterSelect.style.padding = '6px 12px';
    presenterSelect.style.borderRadius = '6px';
    presenterSelect.style.border = '1px solid #cbd5e1';
    presenterSelect.style.fontSize = '0.9rem';
    presenterSelect.style.outline = 'none';
    uniquePresenters.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.innerText = p;
        presenterSelect.appendChild(opt);
    });

    selectorContainer.appendChild(selectorLabel);
    selectorContainer.appendChild(presenterSelect);
    previewCard.appendChild(selectorContainer);

    // Headers Area (To, Subject)
    const headersBox = document.createElement('div');
    headersBox.style.backgroundColor = '#f8fafc';
    headersBox.style.border = '1px solid #e2e8f0';
    headersBox.style.borderRadius = '8px';
    headersBox.style.padding = '12px 16px';
    headersBox.style.marginBottom = '1rem';
    headersBox.style.fontSize = '0.9rem';
    headersBox.style.lineHeight = '1.6';

    const toRow = document.createElement('div');
    toRow.innerHTML = `<strong>An:</strong> <span id="preview-email-to" style="color: #0284c7;">-</span>`;
    const subjectRow = document.createElement('div');
    subjectRow.innerHTML = `<strong>Betreff:</strong> Aktueller Journal Watch Plan`;

    headersBox.appendChild(toRow);
    headersBox.appendChild(subjectRow);
    previewCard.appendChild(headersBox);

    // Live HTML Body container (Scrollable)
    const emailBodyContainer = document.createElement('div');
    emailBodyContainer.style.flex = '1';
    emailBodyContainer.style.overflowY = 'auto';
    emailBodyContainer.style.border = '1px solid #e2e8f0';
    emailBodyContainer.style.borderRadius = '8px';
    emailBodyContainer.style.padding = '15px';
    emailBodyContainer.style.backgroundColor = '#ffffff';
    emailBodyContainer.style.minHeight = '250px';
    emailBodyContainer.style.maxHeight = '400px';
    previewCard.appendChild(emailBodyContainer);

    // Update function
    const updatePreview = () => {
        const selectedPresenter = presenterSelect.value;
        const email = getEmailForPresenter(selectedPresenter);
        const toSpan = previewCard.querySelector('#preview-email-to');
        if (email) {
            toSpan.innerText = `${selectedPresenter} <${email}>`;
            toSpan.style.color = '#0284c7';
        } else {
            toSpan.innerText = `${selectedPresenter} (⚠️ Keine E-Mail-Adresse hinterlegt)`;
            toSpan.style.color = '#ef4444';
        }
        emailBodyContainer.innerHTML = buildPreviewHtml(selectedPresenter);
    };

    presenterSelect.onchange = updatePreview;
    updatePreview(); // Initial render

    // Footer actions
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '12px';
    footer.style.marginTop = '1.5rem';
    footer.style.borderTop = '1px solid #e2e8f0';
    footer.style.paddingTop = '1rem';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = "Abbrechen";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.style.padding = '8px 16px';
    cancelBtn.style.fontSize = '0.95rem';
    cancelBtn.onclick = () => {
        previewOverlay.style.opacity = '0';
        previewCard.style.transform = 'scale(0.9)';
        setTimeout(() => previewOverlay.remove(), 300);
    };

    const sendBtn = document.createElement('button');
    sendBtn.innerText = `✉️ Jetzt an alle ${uniquePresenters.length} Referenten senden`;
    sendBtn.className = "btn btn-primary";
    sendBtn.style.backgroundColor = '#0284c7';
    sendBtn.style.border = 'none';
    sendBtn.style.padding = '8px 20px';
    sendBtn.style.fontSize = '0.95rem';
    sendBtn.onclick = async () => {
        // Close preview
        previewOverlay.remove();
        
        // Open the beautiful processing overlay
        triggerPublishJob();
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(sendBtn);
    previewCard.appendChild(footer);
    previewOverlay.appendChild(previewCard);
    document.body.appendChild(previewOverlay);

    // Fade in
    setTimeout(() => {
        previewOverlay.style.opacity = '1';
        previewCard.style.transform = 'scale(1)';
    }, 10);

    // Processing trigger function
    function triggerPublishJob() {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.6)';
        overlay.style.backdropFilter = 'blur(8px)';
        overlay.style.webkitBackdropFilter = 'blur(8px)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '99999';
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity = '0';

        const card = document.createElement('div');
        card.style.backgroundColor = '#ffffff';
        card.style.borderRadius = '1.5rem';
        card.style.padding = '2.5rem';
        card.style.width = '100%';
        card.style.maxWidth = '480px';
        card.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
        card.style.textAlign = 'center';
        card.style.fontFamily = "'Inter', sans-serif";
        card.style.color = '#1e293b';
        card.style.transform = 'scale(0.9)';
        card.style.transition = 'transform 0.3s ease';

        const spinnerContainer = document.createElement('div');
        spinnerContainer.style.margin = '0 auto 1.5rem';
        spinnerContainer.style.width = '64px';
        spinnerContainer.style.height = '64px';
        spinnerContainer.style.position = 'relative';

        const spinner = document.createElement('div');
        spinner.style.width = '100%';
        spinner.style.height = '100%';
        spinner.style.border = '5px solid #e2e8f0';
        spinner.style.borderTop = '5px solid #0284c7';
        spinner.style.borderRadius = '50%';
        spinner.style.animation = 'spin 1s linear infinite';
        spinnerContainer.appendChild(spinner);

        const title = document.createElement('h3');
        title.innerText = "Plan wird veröffentlicht";
        title.style.fontSize = '1.5rem';
        title.style.fontWeight = '700';
        title.style.marginBottom = '0.75rem';

        const statusText = document.createElement('p');
        statusText.innerText = "Verbindung mit Server wird hergestellt...";
        statusText.style.color = '#64748b';
        statusText.style.fontSize = '0.95rem';
        statusText.style.lineHeight = '1.5';
        statusText.style.marginBottom = '1.5rem';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = "Schließen";
        closeBtn.className = "btn btn-secondary";
        closeBtn.style.display = 'none';
        closeBtn.style.margin = '0 auto';
        closeBtn.onclick = () => {
            overlay.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => overlay.remove(), 300);
        };

        card.appendChild(spinnerContainer);
        card.appendChild(title);
        card.appendChild(statusText);
        card.appendChild(closeBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = '1';
            card.style.transform = 'scale(1)';
        }, 10);

        try {
            db.collection('jw_publish_jobs').add({
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(docRef => {
                const unsubscribe = docRef.onSnapshot((doc) => {
                    if (!doc.exists) return;
                    const data = doc.data();

                    if (data.status === 'processing') {
                        statusText.innerHTML = "✨ <strong>E-Mails werden generiert und versendet...</strong><br>Bitte das Fenster nicht schließen.";
                    } else if (data.status === 'completed') {
                        unsubscribe();
                        spinner.style.borderTopColor = '#10b981';
                        spinner.style.animation = 'none';
                        spinner.style.transform = 'rotate(0deg)';
                        spinner.innerHTML = `<span style="font-size: 2.5rem; line-height: 54px; color: #10b981;">✓</span>`;
                        title.innerText = "Veröffentlichung erfolgreich!";
                        
                        let warningText = "";
                        if (data.warnings && data.warnings.length > 0) {
                            warningText = `<br><br><strong style="color: #d97706;">Hinweis:</strong><ul style="text-align: left; font-size: 0.85rem; color: #b45309; margin-top: 5px; padding-left: 20px;">` + 
                                data.warnings.map(w => `<li>${w}</li>`).join('') + `</ul>`;
                        }

                        statusText.innerHTML = `Der Plan wurde erfolgreich an <strong>${data.sentCount} Referenten</strong> per E-Mail gesendet!${warningText}`;
                        closeBtn.style.display = 'block';
                        closeBtn.className = "btn btn-success";
                        closeBtn.style.backgroundColor = '#10b981';
                        closeBtn.style.border = 'none';
                    } else if (data.status === 'failed') {
                        unsubscribe();
                        spinner.style.borderTopColor = '#ef4444';
                        spinner.style.animation = 'none';
                        spinner.innerHTML = `<span style="font-size: 2.5rem; line-height: 54px; color: #ef4444;">✗</span>`;
                        title.innerText = "Fehler beim Veröffentlichen";
                        statusText.innerHTML = `Ein Fehler ist aufgetreten:<br><code style="color:#ef4444; word-break:break-all;">${data.error || 'Unbekannter Fehler'}</code>`;
                        closeBtn.style.display = 'block';
                        closeBtn.className = "btn btn-danger";
                        closeBtn.style.backgroundColor = '#ef4444';
                        closeBtn.style.border = 'none';
                    }
                }, (error) => {
                    console.error("Firestore job subscription failed:", error);
                    unsubscribe();
                    statusText.innerText = "Verbindungsfehler bei Statusaktualisierung: " + error.message;
                    closeBtn.style.display = 'block';
                });
            }).catch(err => {
                console.error("Failed to start publish job:", err);
                spinner.style.borderTopColor = '#ef4444';
                spinner.style.animation = 'none';
                spinner.innerHTML = `<span style="font-size: 2.5rem; line-height: 54px; color: #ef4444;">✗</span>`;
                title.innerText = "Fehler beim Starten";
                statusText.innerText = "Die Veröffentlichung konnte nicht gestartet werden: " + err.message;
                closeBtn.style.display = 'block';
            });
        } catch (err) {
            console.error("Failed to start publish job:", err);
            spinner.style.borderTopColor = '#ef4444';
            spinner.style.animation = 'none';
            spinner.innerHTML = `<span style="font-size: 2.5rem; line-height: 54px; color: #ef4444;">✗</span>`;
            title.innerText = "Fehler beim Starten";
            statusText.innerText = "Die Veröffentlichung konnte nicht gestartet werden: " + err.message;
            closeBtn.style.display = 'block';
        }
    }
};

// Old saveData function removed
