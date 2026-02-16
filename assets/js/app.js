const BIN_ID = "699332e2ae596e708f2f7434"; // Schedule Bin ID
const API_KEY = "$2a$10$5f5WR8jrQAQp2TgNWGvWb.2tp/RA1ZzQzMv3SY5uwYnm5oqz66yxa"; // Master Key
const ADMIN_PASS = "journal2026"; // Simple shared password

let currentSchedule = []; // Store data locally for editing
let isAdmin = false;

async function loadSchedule() {
    constloading = document.getElementById('loading');
    const tbody = document.getElementById('schedule-body');
    const table = document.getElementById('schedule-table');
    const errorDiv = document.getElementById('error-message');

    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: {
                "X-Master-Key": API_KEY
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("JSONBin Error Context:", errorText);
            throw new Error(`Fehler beim Laden: ${response.status}`);
        }

        const data = await response.json();
        currentSchedule = data.record; // Keep global reference
        renderTable();

        loading.classList.add('hidden');
        table.classList.remove('hidden');

    } catch (error) {
        console.error(error);
        loading.classList.add('hidden');
        errorDiv.textContent = 'Fehler beim Laden des Plans. Bitte später erneut versuchen.';
        errorDiv.classList.remove('hidden');
    }
}

function renderTable() {
    const tbody = document.getElementById('schedule-body');
    const today = new Date().toISOString().split('T')[0];

    // Sort logic
    currentSchedule.sort((a, b) => new Date(a.date) - new Date(b.date));

    tbody.innerHTML = '';

    currentSchedule.forEach((slot, index) => {
        const row = document.createElement('tr');
        const dateObj = new Date(slot.date);
        const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });

        let presenterCell = slot.presenter || '<span style="color:#ccc">Frei</span>';
        let topicCell = slot.topic || '';
        let adminCell = '';

        if (isAdmin) {
            presenterCell = `<input class="edit-field" value="${slot.presenter || ''}" onchange="updateSlot(${index}, 'presenter', this.value)" placeholder="Name">`;
            topicCell = `<input class="edit-field" value="${slot.topic || ''}" onchange="updateSlot(${index}, 'topic', this.value)" placeholder="Thema">`;
            // future enhancements specifically for admin cols can go here
        }

        row.innerHTML = `
            <td>${dateObj.toLocaleDateString('de-DE')}</td>
            <td>${dayName}</td>
            <td>${presenterCell}</td>
            <td>${topicCell}</td>
            <td class="admin-col ${isAdmin ? '' : 'hidden'}">
                <!-- Actions like clear could go here -->
            </td>
        `;

        if (slot.date < today) {
            row.style.opacity = '0.5';
        }

        tbody.appendChild(row);
    });

    // Toggle Admin Column Header
    const adminHeader = document.querySelector('.admin-col');
    if (adminHeader) {
        if (isAdmin) adminHeader.classList.remove('hidden');
        else adminHeader.classList.add('hidden');
    }
}

function updateSlot(index, field, value) {
    currentSchedule[index][field] = value;
}

// --- Admin Functions ---

function showLogin() {
    document.getElementById('login-modal').classList.remove('hidden');
}

function hideLogin() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('password-input').value = '';
}

function checkLogin() {
    const input = document.getElementById('password-input').value;
    if (input === ADMIN_PASS) {
        isAdmin = true;
        document.getElementById('login-btn').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');
        hideLogin();
        renderTable(); // Re-render with edit fields
    } else {
        document.getElementById('login-error').style.display = 'block';
    }
}

function logout() {
    isAdmin = false;
    document.getElementById('login-btn').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    renderTable();
}

async function saveSchedule() {
    const btn = document.querySelector('.save-btn');
    const originalText = btn.textContent;
    btn.textContent = "Speichere...";
    btn.disabled = true;

    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
            method: 'PUT',
            headers: {
                "Content-Type": "application/json",
                "X-Master-Key": API_KEY
            },
            body: JSON.stringify(currentSchedule)
        });

        if (!response.ok) {
            throw new Error("Speichern fehlgeschlagen");
        }

        alert("Plan erfolgreich gespeichert!");
    } catch (e) {
        alert("Fehler beim Speichern: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', loadSchedule);
