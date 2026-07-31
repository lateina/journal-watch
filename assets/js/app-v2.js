let currentSchedule = [];
let currentEmployees = [];
let planerEmployees = [];
let currentDistribution = [];
let isAdmin = false;
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

    // Login search keyboard navigation
    const loginSearchInput = document.getElementById('login-name-search');
    if (loginSearchInput) {
        loginSearchInput.addEventListener('keydown', (e) => {
            const items = document.querySelectorAll('#login-search-results .user-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                loginSearchIndex = (loginSearchIndex + 1) % items.length;
                updateLoginSearchHighlight();
                items[loginSearchIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                loginSearchIndex = (loginSearchIndex - 1 + items.length) % items.length;
                updateLoginSearchHighlight();
                items[loginSearchIndex].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (loginSearchIndex >= 0 && loginSearchIndex < items.length) {
                    items[loginSearchIndex].click();
                } else if (items.length > 0) {
                    items[0].click();
                }
            }
        });
    }

    // Admin Employee List keyboard navigation (works across the whole tab)
    document.addEventListener('keydown', (e) => {
        const empTab = document.getElementById('tab-employees');
        if (!empTab || empTab.classList.contains('hidden')) return;

        // Don't hijack if typing in another input/textarea (except search)
        if (e.target.tagName === 'INPUT' && e.target.id !== 'emp-admin-search') return;
        if (e.target.tagName === 'TEXTAREA') return;

        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        
        const empSearchInput = document.getElementById('emp-admin-search');
        const searchTerm = empSearchInput ? empSearchInput.value.toLowerCase() : '';
        
        const filtered = currentEmployees.map((emp, index) => ({ emp, originalIndex: index }))
            .filter(item => {
                const name = item.emp.name || '';
                const id = item.emp.id || '';
                return name.toLowerCase().includes(searchTerm) || id.toLowerCase().includes(searchTerm);
            });
            
        if (filtered.length === 0) return;

        let currentIndex = filtered.findIndex(item => item.originalIndex === selectedEmpIndex);
        
        if (e.key === 'ArrowDown') {
            currentIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % filtered.length;
        } else if (e.key === 'ArrowUp') {
            currentIndex = currentIndex <= 0 ? filtered.length - 1 : currentIndex - 1;
        }
        
        selectEmployee(filtered[currentIndex].originalIndex);
        
        setTimeout(() => {
            const container = document.getElementById('employee-list-container');
            const selectedEl = document.querySelector('#employee-list-container .emp-list-item.selected');
            if (container && selectedEl) {
                const cHeight = container.clientHeight;
                const cScrollTop = container.scrollTop;
                const elTop = selectedEl.offsetTop;
                const elHeight = selectedEl.offsetHeight;
                
                if (elTop < cScrollTop) {
                    container.scrollTop = elTop;
                } else if (elTop + elHeight > cScrollTop + cHeight) {
                    container.scrollTop = elTop + elHeight - cHeight;
                }
            }
        }, 0);
    });
}

// --- Initialization ---

async function init() {
    console.log("App initializing...");
    setupEventListeners(); // Bind events first

    await loadEmployees(); // Always load employees for login modal

    // Check local storage for key
    const storedRole = localStorage.getItem('journal_user_role');
    if (storedRole) {
        isLoggedIn = true;
        // Legacy fallback: if there's a role, it must be an admin from before the update
        userRole = storedRole || 'admin';
        isAdmin = userRole.includes('admin') || userRole.includes('administrator') || userRole.includes('sekretariat');
        
        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel && isAdmin) {
            adminPanel.classList.remove('hidden');
        }
    }
    
    // Always show main tabs and hide loading (read-only view for everyone)
    const mainTabs = document.getElementById('main-tabs');
    if (mainTabs) mainTabs.classList.remove('hidden');
    document.getElementById('loading').classList.add('hidden');

    setupTabs();
    switchTab('schedule');

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

let jwInactiveIds = [];

async function loadEmployees() {
    try {
        // Load jw_settings for inactive IDs
        const settingsSnap = await db.collection('up_config').doc('jw_settings').get();
        if (settingsSnap.exists) {
            jwInactiveIds = settingsSnap.data().inactive_ids || [];
        } else {
            jwInactiveIds = [];
        }

        // Load employees from Urlaubsplaner (Single Source of Truth)
        const docSnap = await db.collection('up_config').doc('main').get();
        if (docSnap.exists) {
            const data = docSnap.data();
            const firebaseEmployees = data.employees || [];
            
            currentEmployees = firebaseEmployees.map(emp => {
                const role = (emp.role || emp.rolle || '').toLowerCase();
                const groups = Array.isArray(emp.groups) ? emp.groups.map(g=>String(g).toLowerCase()) : (emp.group ? [String(emp.group).toLowerCase()] : []);
                
                const isOA = role.includes('oberarzt') || role.includes('foa') || groups.some(g => g.includes('oberarzt'));
                const isSek = String(emp.name || "").toLowerCase().includes('sekretariat') || role.includes('sekretariat');
                
                return {
                    ...emp,
                    jw_active: !jwInactiveIds.includes(emp.id), 
                    isOberarzt: isOA && !isSek
                };
            });



            console.log("Mitarbeiter erfolgreich geladen (SSOT):", currentEmployees.length);
        } else {
            console.warn("No up_config/main found in Firestore.");
            currentEmployees = [];
        }

        // Load legacy Planer570 state to get Rotanden aliases
        try {
            const planerSnap = await db.collection('planer_app_state').doc('currentState').get();
            if (planerSnap.exists) {
                const data = planerSnap.data();
                planerEmployees = data.employees || data.mitarbeiter || [];
            } else {
                planerEmployees = [];
            }
        } catch (e) {
            console.warn("Failed to load planer_app_state for aliases", e);
        }
        
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
        const snapshot = await db.collection('rotations_v2').get();
        const assignments = [];
        snapshot.forEach(docSnap => {
            const docId = docSnap.id; // e.g. "month_2026_03"
            const monthId = docId.replace('month_', ''); // "2026_03"
            const data = docSnap.data();
            if (data.assignments) {
                Object.entries(data.assignments).forEach(([areaKey, tokenList]) => {
                    // Filter out duplicate suffix keys like HFU_month_2026_03
                    if (areaKey.includes('_month_')) return;
                    if (Array.isArray(tokenList)) {
                        tokenList.forEach(token => {
                            if (token && token.mitarbeiter_id) {
                                // Lookup employee name
                                const emp = currentEmployees.find(e => e.id === token.mitarbeiter_id);
                                assignments.push({
                                    mi: monthId,
                                    bi: areaKey.replace(/_/g, '').toLowerCase(),
                                    ei: token.mitarbeiter_id,
                                    en: emp ? emp.name : "Unbekannt"
                                });
                            }
                        });
                    }
                });
            }
        });
        currentDistribution = assignments;
        console.log("Distribution loaded (SSOT):", currentDistribution.length);
        renderDistribution();
    } catch (e) {
        console.warn("Fehler beim Laden der Verteilung (SSOT):", e);
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

window.getActiveRotandName = function(empName, dateObj) {
    if (!planerEmployees || planerEmployees.length === 0) return null;
    const pEmp = planerEmployees.find(p => p.name === empName || p.mitarbeiter_name === empName);
    if (!pEmp || !pEmp.is_rotandenstelle) return null;
    
    if (!pEmp.rotanden_namen || !Array.isArray(pEmp.rotanden_namen)) return null;
    
    const targetMonthId = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    
    const activeNames = pEmp.rotanden_namen.filter(rn => {
        if (!rn.name) return false;
        
        const parseMonth = (str) => {
            if (!str) return null;
            if (str.includes('-')) {
                const parts = str.split('-');
                if (parts.length >= 2) return `${parts[0]}-${parts[1].padStart(2, '0')}`;
            }
            const parts = str.split('/');
            if (parts.length === 2) return `${parts[1]}-${parts[0].padStart(2, '0')}`;
            return null;
        };
        
        const start = parseMonth(rn.von);
        const end = parseMonth(rn.bis);
        
        if (start && start > targetMonthId) return false;
        if (end && end < targetMonthId) return false;
        return true;
    });
    
    if (activeNames.length > 0) {
        const parseMonth = (str) => {
            if (!str) return null;
            if (str.includes('-')) {
                const parts = str.split('-');
                if (parts.length >= 2) return `${parts[0]}-${parts[1].padStart(2, '0')}`;
            }
            const parts = str.split('/');
            if (parts.length === 2) return `${parts[1]}-${parts[0].padStart(2, '0')}`;
            return null;
        };
        
        // Prefer entries that have at least one explicit date bound
        const explicitMatches = activeNames.filter(rn => parseMonth(rn.von) || parseMonth(rn.bis));
        
        if (explicitMatches.length > 0) {
            return explicitMatches.map(rn => rn.name).join(' / ');
        }
        
        // Fallback to all matches if none have valid bounds
        return activeNames.map(rn => rn.name).join(' / ');
    }
    return null;
}

window.renderSchedule = function () {
    const table = document.getElementById('schedule-table');
    const tbody = document.getElementById('schedule-body');
    if (!table || !tbody) return;

    // Hide error message on successful render
    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }

    // Update UI visibility
    const controls = document.getElementById('schedule-controls');
    if (table) table.classList.remove('hidden');
    if (controls) {
        controls.classList.remove('hidden');
        controls.style.display = 'flex';
    }
    document.getElementById('loading').classList.add('hidden');

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

        let presenterCell = '<span style="color:#cbd5e1">Frei</span>';
        if (slot.presenter) {
            const alias = getActiveRotandName(slot.presenter, dateObj);
            presenterCell = alias ? `<strong>${alias}</strong> <span style="font-size:0.8em;color:gray;">(${slot.presenter})</span>` : slot.presenter;
        }
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
                                const alias = getActiveRotandName(emp.name, dateObj);
                                const dispName = alias ? `${emp.name} ➡️ ${alias}` : emp.name;
                                options += `<option value="${emp.name}" ${selected}>${dispName}</option>`;
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
let selectedEmpIndex = null;

function renderEmployees() {
    const listContainer = document.getElementById('employee-list-container');
    const detailContainer = document.getElementById('employee-detail-container');
    const searchInput = document.getElementById('emp-admin-search');
    
    if (!listContainer || !detailContainer) return;

    const isFullAdmin = isAdmin && userRole === 'admin';
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    currentEmployees.sort(sortEmployeesByName);

    listContainer.innerHTML = '';
    
    // Filter employees
    const filteredEmployees = currentEmployees.map((emp, index) => ({ emp, originalIndex: index }))
        .filter(item => {
            const name = item.emp.name || '';
            const id = item.emp.id || '';
            return name.toLowerCase().includes(searchTerm) || id.toLowerCase().includes(searchTerm);
        });

    if (filteredEmployees.length === 0) {
        listContainer.innerHTML = '<div style="padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">Keine Mitarbeiter gefunden.</div>';
    } else {
        filteredEmployees.forEach(item => {
            const emp = item.emp;
            const index = item.originalIndex;
            
            const div = document.createElement('div');
            div.className = `emp-list-item ${selectedEmpIndex === index ? 'selected' : ''}`;
            div.setAttribute('data-index', index);
            if (!emp.active && !emp.jw_active) div.style.opacity = '0.5';
            
            div.onclick = () => selectEmployee(index);
            
            let badges = [];
            if (emp.isOberarzt) badges.push('OA');
            if (!emp.jw_active) badges.push('Inaktiv');
            
            const alias = getActiveRotandName(emp.name, new Date());
            if (alias) badges.push(`Aktuell: ${alias}`);

            div.innerHTML = `
                <div class="emp-list-item-name">${emp.name || 'Unbenannt'}</div>
                <div class="emp-list-item-sub">
                    ${emp.id || 'Keine ID'}
                    ${badges.length > 0 ? ` &bull; <span style="color: var(--accent);">${badges.join(', ')}</span>` : ''}
                </div>
            `;
            listContainer.appendChild(div);
        });
    }

    renderEmployeeDetails();
    updateAdminUI();
}

window.selectEmployee = function(index) {
    selectedEmpIndex = index;
    
    // Update selection UI without full re-render
    document.querySelectorAll('#employee-list-container .emp-list-item').forEach(el => {
        el.classList.remove('selected');
    });
    const selectedEl = document.querySelector(`#employee-list-container .emp-list-item[data-index="${index}"]`);
    if (selectedEl) {
        selectedEl.classList.add('selected');
    }
    
    renderEmployeeDetails();
}

function renderEmployeeDetails() {
    const detailContainer = document.getElementById('employee-detail-container');
    if (!detailContainer) return;
    
    const isFullAdmin = isAdmin && userRole === 'admin';

    if (selectedEmpIndex === null || !currentEmployees[selectedEmpIndex]) {
        detailContainer.innerHTML = '<div class="center-text" style="color: var(--text-muted); margin-top: 4rem;">Bitte wählen Sie einen Mitarbeiter aus der Liste.</div>';
        return;
    }

    const emp = currentEmployees[selectedEmpIndex];
    
    let rotandenHTML = '';
    if (planerEmployees && planerEmployees.length > 0) {
        const pEmp = planerEmployees.find(p => p.name === emp.name || p.mitarbeiter_name === emp.name);
        if (pEmp && pEmp.is_rotandenstelle && Array.isArray(pEmp.rotanden_namen)) {
            const formatGermanDate = (str, isEnd) => {
                if (!str) return '';
                const parts = str.split('/');
                if (parts.length === 2) {
                    const mm = parseInt(parts[0], 10);
                    const yyyy = parseInt(parts[1], 10);
                    if (!isNaN(mm) && !isNaN(yyyy)) {
                        if (isEnd) {
                            const lastDay = new Date(yyyy, mm, 0).getDate();
                            return `${String(lastDay).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${yyyy}`;
                        } else {
                            return `01.${String(mm).padStart(2, '0')}.${yyyy}`;
                        }
                    }
                }
                if (parts.length === 3) {
                    return `${parts[0].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[2]}`;
                }
                
                // Handle YYYY-MM-DD
                if (str.includes('-')) {
                    const dParts = str.split('-');
                    if (dParts.length === 3) {
                        return `${dParts[2].padStart(2, '0')}.${dParts[1].padStart(2, '0')}.${dParts[0]}`;
                    }
                }
                
                return str.replace(/\//g, '.');
            };

            const list = pEmp.rotanden_namen.map(rn => {
                const startStr = formatGermanDate(rn.von, false) || 'Anfang';
                const endStr = formatGermanDate(rn.bis, true) || 'Ende';
                return `<div style="font-size: 0.9rem; padding: 0.25rem 0; border-bottom: 1px solid #e2e8f0;">
                    <span style="font-weight: 500; color: var(--text);">${rn.name || 'Unbekannt'}</span> 
                    <span style="color: var(--text-muted); font-size: 0.8rem;">(${startStr} bis ${endStr})</span>
                </div>`;
            }).join('');
            
            rotandenHTML = `
            <div class="detail-form-group" style="margin-top: 1rem;">
                <label>Zugewiesene Namen (Historie)</label>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 0.5rem 1rem;">
                    ${list || '<div style="color: var(--text-muted); font-size: 0.9rem;">Keine Zuweisungen hinterlegt.</div>'}
                </div>
            </div>`;
        }
    }
    
    if (!isFullAdmin) {
        detailContainer.innerHTML = `
            <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">${emp.name}</h2>
            <div style="color: var(--text-muted); margin-bottom: 2rem;">ID: ${emp.id || '-'}</div>
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <div><strong>Email:</strong> ${emp.email || '-'}</div>
                <div><strong>Rolle:</strong> ${emp.isOberarzt ? 'Oberarzt' : 'Assistenzarzt'}</div>
                <div><strong>Status:</strong> ${emp.jw_active ? 'Aktiv in Verteilung' : 'Inaktiv (Pausiert)'}</div>
                ${rotandenHTML ? `<div><strong>Alias Zuweisungen:</strong><div style="margin-top:0.5rem;">${rotandenHTML}</div></div>` : ''}
            </div>
        `;
        return;
    }

    detailContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
            <div>
                <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">Mitarbeiter Details</h2>
                <div style="font-size: 0.85rem; color: var(--text-muted);">Schreibgeschützt (Daten aus Planer570)</div>
            </div>
        </div>
        
        <div class="detail-form-group">
            <label>Name</label>
            <div style="font-size:1.1rem; font-weight:600; color:var(--text);">${emp.name || '-'}</div>
        </div>
        <div class="detail-form-group">
            <label>Aktueller Alias / Name (heute)</label>
            <div style="font-size:1rem; font-weight:500; color:var(--accent);">${getActiveRotandName(emp.name, new Date()) || '-'}</div>
        </div>
        ${rotandenHTML}
        <div class="detail-form-group">
            <label>System-ID</label>
            <div style="padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; color: var(--text-muted);">${emp.id || '-'}</div>
        </div>
        
        <div class="detail-form-group">
            <label>E-Mail Adresse</label>
            <div style="padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; color: var(--text-muted);">${emp.email || '-'}</div>
        </div>
        
        <div style="display: flex; gap: 2rem; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e2e8f0;">
            <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-muted);">
                <input type="checkbox" disabled ${emp.isOberarzt ? 'checked' : ''}>
                <span style="font-weight: 500;">Ist Oberarzt</span>
            </div>
            
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;" class="custom-tooltip" data-tooltip="Entfernt den Mitarbeiter temporär aus der Zuteilung (z.B. Elternzeit, Rotation).">
                <input type="checkbox" ${emp.jw_active ? 'checked' : ''} onchange="updateEmployee(${selectedEmpIndex}, 'jw_active', this.checked)">
                <span style="font-weight: 500; color: var(--text-main);">Aktiv (in Zuteilung)</span>
            </label>
        </div>
    `;
}

function updateAdminUI() {
    const isFullAdmin = isAdmin && userRole === 'admin';

    document.querySelectorAll('.admin-col').forEach(el => {
        if (isFullAdmin) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    // Toggle Employee Tab Visibility - For Admin and Sekretariat
    const employeeTabBtn = document.querySelector('button[data-tab="employees"]');
    if (employeeTabBtn) {
        if (isAdmin) employeeTabBtn.classList.remove('hidden');
        else employeeTabBtn.classList.add('hidden');
    }

    // Toggle Bulk Import Section (Removed)
    const bulkImportSection = document.getElementById('bulk-import-section');
    if (bulkImportSection) {
        bulkImportSection.classList.add('hidden');
    }

    // Toggle Logout Button
    // Login / Logout Buttons in Header
    const loginBtn = document.getElementById('login-header-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (loginBtn && logoutBtn) {
        if (isLoggedIn) {
            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
        } else {
            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
        }
    }
}

window.importFromPlaner570 = async function() {
    if (!confirm("Dies lädt die aktuelle Mitarbeiterliste (inkl. Urlaubsplaner-Einstellungen) aus Firebase herunter und aktualisiert/ergänzt die bestehende Liste.\n\nMöchten Sie fortfahren?")) return;
    
    try {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.classList.remove('hidden');
        
        const docSnap = await db.collection('planer_app_state').doc('currentState').get();
        if (!docSnap.exists) {
            throw new Error("Konnte planer_app_state/currentState nicht in Firebase finden.");
        }
        
        const data = docSnap.data();
        const firebaseEmployees = data.mitarbeiter || [];
        
        if (!Array.isArray(firebaseEmployees) || firebaseEmployees.length === 0) {
            throw new Error("Die Mitarbeiterliste in Firebase ist leer oder fehlerhaft formatiert.");
        }
        
        let addedCount = 0;
        let updatedCount = 0;
        
        firebaseEmployees.forEach(fEmp => {
            if (!fEmp.name) return;
            
            // Try matching by ID first, then by exact name
            let localEmp = null;
            if (fEmp.id) {
                localEmp = currentEmployees.find(e => e.id === fEmp.id);
            }
            if (!localEmp && fEmp.name) {
                localEmp = currentEmployees.find(e => e.name === fEmp.name);
            }
            
            // Determine OA status from Firebase data
            const role = (fEmp.role || fEmp.rolle || '').toLowerCase();
            const groups = Array.isArray(fEmp.groups) ? fEmp.groups.map(g=>String(g).toLowerCase()) : (fEmp.group ? [String(fEmp.group).toLowerCase()] : []);
            
            const isOA = role.includes('oberarzt') || role.includes('foa') || groups.some(g => g.includes('oberarzt'));
            const isSek = fEmp.name.toLowerCase().includes('sekretariat') || role.includes('sekretariat');
            const finalIsOA = isOA && !isSek;
            
            if (localEmp) {
                // Update missing/different fields
                let modified = false;
                if (!localEmp.id && fEmp.id) { localEmp.id = fEmp.id; modified = true; }
                if (localEmp.isOberarzt !== finalIsOA) { localEmp.isOberarzt = finalIsOA; modified = true; }
                if (fEmp.email && (!localEmp.email || localEmp.email === '@' || localEmp.email === '')) {
                    localEmp.email = fEmp.email;
                    modified = true;
                }
                if (fEmp.stampAlias && !localEmp.stampAlias) {
                    localEmp.stampAlias = fEmp.stampAlias;
                    modified = true;
                }
                
                if (modified) updatedCount++;
            } else {
                // Add new employee
                currentEmployees.push({
                    id: fEmp.id || "",
                    name: fEmp.name,
                    email: fEmp.email || "@",
                    active: true,
                    jw_active: true, // Default to active for Journal Watch
                    isOberarzt: finalIsOA,
                    stampAlias: fEmp.stampAlias || null
                });
                addedCount++;
            }
        });
        
        setUnsavedChanges(true);
        renderEmployees();
        renderSchedule(); // Update dropdowns
        
        if (loadingDiv) loadingDiv.classList.add('hidden');
        
        alert(`Import erfolgreich!\n\nNeue Mitarbeiter: ${addedCount}\nAktualisiert: ${updatedCount}\n\nBitte "Speichern" nicht vergessen.`);
        
    } catch (e) {
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) loadingDiv.classList.add('hidden');
        
        console.error("Import error:", e);
        alert("Fehler beim Importieren: " + e.message);
    }
}

// --- Updates (Memory) ---

window.updateSlot = function (index, field, value) {
    currentSchedule[index][field] = value;
    setUnsavedChanges(true);
    if (field === 'presenter') renderSchedule(); // Re-calc stats immediately
}

window.updateEmployee = function (index, field, value) {
    if (field === 'jw_active') {
        currentEmployees[index].jw_active = value;
        const empId = currentEmployees[index].id;
        
        if (value) {
            // Remove from inactive list
            jwInactiveIds = jwInactiveIds.filter(id => id !== empId);
        } else {
            // Add to inactive list
            if (empId && !jwInactiveIds.includes(empId)) {
                jwInactiveIds.push(empId);
            }
        }
        
        setUnsavedChanges(true);
        renderSchedule(); // Re-render schedule to update dropdowns
        renderEmployees(); // Re-render employee list to update badges
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

let loginSearchIndex = -1;
window.updateLoginSearchHighlight = function() {
    const items = document.querySelectorAll('#login-search-results .user-item');
    items.forEach((item, idx) => {
        if (idx === loginSearchIndex) {
            item.style.backgroundColor = '#f1f5f9'; // Hover background
        } else {
            item.style.backgroundColor = 'transparent';
        }
    });
};

window.filterLoginNames = function () {
    const searchInput = document.getElementById('login-name-search');
    const resultsContainer = document.getElementById('login-search-results');
    const query = searchInput.value.toLowerCase().trim();
    loginSearchIndex = -1;

    if (!query) {
        resultsContainer.classList.add('hidden');
        return;
    }

    // 1. Specific search for admin and Sekretariat (prioritized)
    // We ignore the 'active' status here because you must be able to log in even if inactive
    const specialNames = ['admin', 'Administrator', 'Sekretariat'];
    const specialMatches = currentEmployees.filter(emp => {
        const name = String(emp.name || "").toLowerCase();
        return (specialNames.some(sn => name.includes(sn.toLowerCase())) || name.startsWith('admin')) && name.includes(query);
    });

    // 2. Search for others who might have the role
    const otherMatches = currentEmployees.filter(emp => {
        const name = String(emp.name || "").toLowerCase();
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
            div.textContent = emp.name || "Unbekannt";
            div.onmouseenter = () => {
                loginSearchIndex = Array.from(resultsContainer.children).indexOf(div);
                updateLoginSearchHighlight();
            };
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
            localStorage.setItem('journal_user_role', userRole);

            const mainTabs = document.getElementById('main-tabs');
            if (mainTabs) mainTabs.classList.remove('hidden');
        }

        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.classList.remove('hidden');
        hideLogin();

        await Promise.all([
            loadSchedule(),
            loadDistribution(configSnap)
        ]);

        renderSchedule();
        renderEmployees();
        // renderDistribution is called inside loadDistribution
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
    localStorage.removeItem('journal_user_role'); // Clear
    localStorage.removeItem('journal_api_key'); // Clear legacy keys

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
    const nameA = (a.name || "").trim();
    const nameB = (b.name || "").trim();

    if (!nameA && !nameB) return 0;
    if (!nameA) return 1;
    if (!nameB) return -1;

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

        // 2. Save jw_settings (inactive IDs)
        await db.collection('up_config').doc('jw_settings').set({
                            inactive_ids: jwInactiveIds,
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
