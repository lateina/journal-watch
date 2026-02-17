const SCHEDULE_BIN_ID = "699332e2ae596e708f2f7434"; // Schedule
const EMPLOYEES_BIN_ID = "699333dcd0ea881f40bf132f"; // Employees

let currentSchedule = [];
let currentEmployees = [];
let isAdmin = false;
let apiKey = null;

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
        renderEmployees();
        renderSchedule(); // Re-render schedule to populate dropdowns
    } catch (e) {
        console.warn("Fehler beim Laden der Mitarbeiter:", e);
        currentEmployees = []; // Fallback
        renderEmployees();
    }
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
        let combinedStatsCell = "";

        if (holidayName) {
            isHoliday = true;
            row.classList.add('holiday-row');
            presenterCell = `<strong>${holidayName}</strong>`;
            topicCell = "Kein Journal Watch";
            combinedStatsCell = "-";
            forgottenCell = "-";
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
        }

        if (isAdmin && !isHoliday) {
            // Build Dropdown
            let options = `<option value="">-- Wähle Referent --</option>`;
            if (currentEmployees && Array.isArray(currentEmployees)) {
                currentEmployees.forEach(emp => {
                    if (emp.active) {
                        const selected = (slot.presenter === emp.name) ? 'selected' : '';
                        options += `<option value="${emp.name}" ${selected}>${emp.name}</option>`;
                    }
                });
            }
            // Keep current value if not in list (legacy support)
            if (slot.presenter && (!currentEmployees || !currentEmployees.find(e => e.name === slot.presenter && e.active))) {
                options += `<option value="${slot.presenter}" selected>${slot.presenter} (Archiv)</option>`;
            }

            presenterCell = `<select class="edit-field" onchange="updateSlot(${index}, 'presenter', this.value)">${options}</select>`;
            topicCell = `<input class="edit-field" value="${slot.topic || ''}" onchange="updateSlot(${index}, 'topic', this.value)" placeholder="Thema">`;
        }

        row.innerHTML = `
            <td>${dateObj.toLocaleDateString('de-DE')}</td>
            <td>${dayName}</td>
            <td>${presenterCell}</td>
            <td class="center-text stats-tooltip">${combinedStatsCell}</td>
            <td class="center-text">${forgottenCell}</td>
            <td class="center-text">
                ${isAdmin ? `
                <select class="swap-select" onchange="handleSwap(${index}, this.value)">
                    <option value="">Tauschen...</option>
                    ${currentEmployees.filter(e => e.active && e.name !== slot.presenter).map(e => `<option value="${e.name}">${e.name}</option>`).join('')}
                </select>` : '-'}
            </td>
            <td>${topicCell}</td>
        `;

        if (slot.date < today && !isHoliday && !slot.forgotten) row.style.opacity = '0.5';
        tbody.appendChild(row);
    });

    updateAdminUI();
}

// --- Helper: Holidays 2026 (Bavaria) ---
function checkHoliday(dateObj) {
    const year = dateObj.getFullYear();
    if (year !== 2026) return null; // Logic focused on 2026 for now as requested

    const month = dateObj.getMonth() + 1; // 1-12
    const day = dateObj.getDate();
    const dateStr = `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.`;

    // Fixed Holidays 2026
    const holidays = {
        "01.01.": "Neujahr",
        "06.01.": "Heilige Drei Könige",
        "03.04.": "Karfreitag",
        "06.04.": "Ostermontag",
        "01.05.": "Tag der Arbeit",
        "14.05.": "Christi Himmelfahrt",
        "25.05.": "Pfingstmontag",
        "04.06.": "Fronleichnam",
        "15.08.": "Mariä Himmelfahrt",
        "03.10.": "Tag der Deutschen Einheit",
        "01.11.": "Allerheiligen",
        "25.12.": "1. Weihnachtsfeiertag",
        "26.12.": "2. Weihnachtsfeiertag"
    };

    if (holidays[dateStr]) return holidays[dateStr];

    // Summer Holidays 2026: Aug 3 - Sep 14
    // Month is 0-indexed in JS Date, but I used 1-based above.
    // Let's use numeric comparison for ranges.
    const time = dateObj.getTime();
    const summerStart = new Date('2026-08-03').getTime();
    const summerEnd = new Date('2026-09-14').getTime();

    if (time >= summerStart && time <= summerEnd) {
        return "Sommerferien";
    }

    return null;
}
window.toggleForgotten = function (index, isChecked) {
    const slot = currentSchedule[index];
    slot.forgotten = isChecked;

    if (isChecked) {
        // Find next free slot
        const oldDate = new Date(slot.date).toLocaleDateString('de-DE');
        const presenter = slot.presenter;
        let found = false;

        for (let i = index + 1; i < currentSchedule.length; i++) {
            const potential = currentSchedule[i];
            // Must be empty AND not a holiday
            if ((!potential.presenter || potential.presenter === "") && !checkHoliday(new Date(potential.date))) {
                potential.presenter = presenter;
                potential.topic = `Nachholtermin für ${oldDate}`;
                found = true;
                alert(`${presenter} wurde automatisch auf den ${new Date(potential.date).toLocaleDateString('de-DE')} verschoben.`);
                break;
            }
        }

        if (!found) {
            alert("Warnung: Kein freier Termin für die Verschiebung gefunden!");
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

    // Sort employees alphabetically by last name before rendering
    currentEmployees.sort((a, b) => {
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
    });

    tbody.innerHTML = '';

    currentEmployees.forEach((emp, index) => {
        const row = document.createElement('tr');

        let nameCell = emp.name;
        let emailCell = emp.email;
        let activeCell = emp.active ? "Ja" : "Nein";
        let actionCell = "";

        if (isAdmin) {
            nameCell = `<input class="edit-field" value="${emp.name || ''}" onchange="updateEmployee(${index}, 'name', this.value)">`;
            emailCell = `<input class="edit-field" value="${emp.email || ''}" onchange="updateEmployee(${index}, 'email', this.value)">`;
            activeCell = `<input type="checkbox" ${emp.active ? 'checked' : ''} onchange="updateEmployee(${index}, 'active', this.checked)">`;
            actionCell = `<button class="delete-btn" onclick="deleteEmployee(${index})">Löschen</button>`;
        }

        row.innerHTML = `
            <td>${nameCell}</td>
            <td>${emailCell}</td>
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
    if (field === 'presenter') renderSchedule(); // Re-calc stats immediately
}

window.updateEmployee = function (index, field, value) {
    currentEmployees[index][field] = value;
    // If name or active status changes, we must re-render the schedule dropdowns
    if (field === 'name' || field === 'active') {
        renderSchedule();
    }
}

window.addEmployee = function () {
    if (!currentEmployees) currentEmployees = [];
    currentEmployees.push({ name: "Neu", email: "@", active: true });
    renderEmployees();
    renderSchedule(); // Update dropdowns immediately
}

window.deleteEmployee = function (index) {
    if (confirm("Mitarbeiter wirklich löschen?")) {
        currentEmployees.splice(index, 1);
        renderEmployees();
        renderSchedule(); // Update dropdowns immediately
    }
}

// --- Tabs ---

function setupTabs() {
    window.switchTab = function (tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

        const activeBtn = document.querySelector(`button[onclick="switchTab('${tabName}')"]`);
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
            renderSchedule();
            renderEmployees();
            updateAdminUI();
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

    // Find all future non-holiday slots assigned to targetName
    // We check the whole schedule but maybe we should focus on future?
    // Let's stick to future slots to avoid confusion with past swaps
    // Actually, user might want to swap with a past date if correcting mistakes?
    // Let's filter for all valid slots that are NOT holidays.
    const targetIndices = currentSchedule.map((slot, idx) => ({ slot, idx }))
        .filter(({ slot }) => slot.presenter === targetName && !checkHoliday(new Date(slot.date)))
        .map(({ idx }) => idx);

    if (targetIndices.length === 0) {
        // Case 3: No target slots -> Replacement
        if (confirm(`'${targetName}' hat keine eigenen Termine.\nSoll er/sie diesen Termin (${sourceSlot.date}) übernehmen?`)) {
            sourceSlot.presenter = targetName;
            // Clear stats/forgotten flags? Maybe keep them?
            // If replacing, we should probably reset forgotten status if it was set for the previous person?
            // Let's leave flags as is for now, or reset forgotten if new person takes over?
            // If source was forgotten, and new person takes over, is it still forgotten? Probably not.
            sourceSlot.forgotten = false;
            saveSchedule();
            renderSchedule();
        } else {
            renderSchedule(); // Reset dropdown
        }
    } else if (targetIndices.length === 1) {
        // Case 1: Exactly one target slot -> Swap
        const targetIndex = targetIndices[0];
        const targetSlot = currentSchedule[targetIndex];
        if (confirm(`Tausch bestätigen:\n\n${sourceName || "Leer"} (${sourceSlot.date})\n↔\n${targetName} (${targetSlot.date})`)) {
            // Perform Swap
            sourceSlot.presenter = targetName;
            // Perform Swap
            sourceSlot.presenter = targetName;
            // blockHoliday was implicit global, fixing it (though unused logically here, keeping for safety or removing if logic implies)
            // Actually, we don't seem to use blockHoliday after assignment? 
            // The original code assigned it. Let's declare it to be safe.
            const blockHoliday = checkHoliday(new Date(sourceSlot.date));

            targetSlot.presenter = sourceName;
            // Reset forgotten on both? Or swap them?
            // Only reset if it makes sense. Let's just swap names.
            saveSchedule();
            renderSchedule();
        } else {
            renderSchedule(); // Reset dropdown
        }
    } else {
        // ... (rest of function)
    }
};

window.saveSchedule = async function () {
    const btn = document.querySelector('.save-btn');
    const originalText = btn.textContent;
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        await saveData(SCHEDULE_BIN_ID, currentSchedule);
        await saveData(EMPLOYEES_BIN_ID, currentEmployees);
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
