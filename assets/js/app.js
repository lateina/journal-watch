const SCHEDULE_BIN_ID = "699332e2ae596e708f2f7434"; // Schedule
const EMPLOYEES_BIN_ID = "699333dcd0ea881f40bf132f"; // Employees
const API_KEY = "$2a$10$5f5WR8jrQAQp2TgNWGvWb.2tp/RA1ZzQzMv3SY5uwYnm5oqz66yxa"; // Master Key
const ADMIN_PASS = "journal2026";

let currentSchedule = [];
let currentEmployees = [];
let isAdmin = false;

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

    const logoutBtn = document.querySelector('#admin-panel button:last-of-type'); // Logout
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Add Employee
    const addEmpBtn = document.getElementById('add-employee-btn');
    if (addEmpBtn) {
        addEmpBtn.addEventListener('click', addEmployee);
    }
}

// --- Initialization ---

async function init() {
    console.log("App initializing...");
    setupEventListeners(); // Bind events first

    // Check local storage for session
    if (localStorage.getItem('journal_admin_session') === 'true') {
        isAdmin = true;
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
    const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        headers: { "X-Master-Key": API_KEY }
    });
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
    currentSchedule.forEach(s => {
        if (s.presenter && s.presenter !== "" && !checkHoliday(new Date(s.date))) {
            stats[s.presenter] = (stats[s.presenter] || 0) + 1;
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

        if (holidayName) {
            isHoliday = true;
            row.classList.add('holiday-row');
            presenterCell = `<strong>${holidayName}</strong>`;
            topicCell = "Kein Journal Watch";
            countCell = "-";
        } else {
            const count = (slot.presenter && stats[slot.presenter]) ? stats[slot.presenter] : 0;
            countCell = count > 0 ? count : "-";
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
        } else if (isAdmin && isHoliday) {
            // Admin sees holiday but can't edit
            // Optional: Add a hidden input or just rely on visual? 
            // Better to visually indicate it's locked.
        }

        row.innerHTML = `
            <td>${dateObj.toLocaleDateString('de-DE')}</td>
            <td>${dayName}</td>
            <td>${presenterCell}</td>
            <td>${countCell}</td>
            <td>${topicCell}</td>
            <td class="admin-col ${isAdmin ? '' : 'hidden'}"></td>
        `;

        if (slot.date < today && !isHoliday) row.style.opacity = '0.5';
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

function renderEmployees() {
    const table = document.getElementById('employee-table');
    const tbody = document.getElementById('employee-body');
    if (!tbody || !table) return;

    // Make table visible
    table.classList.remove('hidden');

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
}

// --- Updates (Memory) ---

window.updateSlot = function (index, field, value) {
    currentSchedule[index][field] = value;
    if (field === 'presenter') renderSchedule(); // Re-calc stats immediately
}

window.updateEmployee = function (index, field, value) {
    currentEmployees[index][field] = value;
}

window.addEmployee = function () {
    if (!currentEmployees) currentEmployees = [];
    currentEmployees.push({ name: "Neu", email: "@", active: true });
    renderEmployees();
}

window.deleteEmployee = function (index) {
    if (confirm("Mitarbeiter wirklich löschen?")) {
        currentEmployees.splice(index, 1);
        renderEmployees();
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

window.checkLogin = function () {
    const input = document.getElementById('password-input').value;
    if (input === ADMIN_PASS) {
        isAdmin = true;
        localStorage.setItem('journal_admin_session', 'true'); // Persist
        document.getElementById('login-btn').classList.add('hidden');
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');
        hideLogin();
        renderSchedule();
        renderEmployees();
    } else {
        const err = document.getElementById('login-error');
        if (err) err.style.display = 'block';
    }
}

window.logout = function () {
    isAdmin = false;
    localStorage.removeItem('journal_admin_session'); // Clear
    document.getElementById('login-btn').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    renderSchedule();
    renderEmployees();
}

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
    const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: 'PUT',
        headers: {
            "Content-Type": "application/json",
            "X-Master-Key": API_KEY
        },
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error("Update fehlgeschlagen für Bin " + binId);
}
