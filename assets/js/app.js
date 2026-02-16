const BIN_ID = "699332e2ae596e708f2f7434"; // Schedule Bin ID
const API_KEY = "$2a$10$5f5WR8jrQAQp2TgNWGvWb.2tp/RA1ZzQzMv3SY5uwYnm5oqz66yxa"; // Master Key (Ensure this bin is set to Public Read if possible, or use this key)
// ideally we use a specific Access Key for reading.

async function loadSchedule() {
    const loading = document.getElementById('loading');
    const table = document.getElementById('schedule-table');
    const tbody = document.getElementById('schedule-body');
    const errorDiv = document.getElementById('error-message');

    try {
        // If Bin is private, we need X-Master-Key or X-Access-Key headers
        const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: {
                // "X-Master-Key": API_KEY, // Uncomment if using private bin with Master Key (Warning: Exposed in frontend source!)
                "X-Access-Key": API_KEY // Better to use a specific read-only access key
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to load data: ${response.status}`);
        }

        const data = await response.json();
        const schedule = data.record;

        tbody.innerHTML = '';

        // Filter for future dates or show all? Let's show all for now or current month onwards.
        // Let's just show all and maybe scroll to current?

        const today = new Date().toISOString().split('T')[0];

        schedule.sort((a, b) => new Date(a.date) - new Date(b.date));

        schedule.forEach(slot => {
            const row = document.createElement('tr');
            const dateObj = new Date(slot.date);
            const dayName = dateObj.toLocaleDateString('de-DE', { weekday: 'long' });

            row.innerHTML = `
                <td>${slot.date}</td>
                <td>${dayName}</td>
                <td>${slot.presenter || '<span style="color:#ccc">Available</span>'}</td>
                <td>${slot.topic || ''}</td>
            `;

            if (slot.date < today) {
                row.style.opacity = '0.5'; // Dim past events
            }

            tbody.appendChild(row);
        });

        loading.classList.add('hidden');
        table.classList.remove('hidden');

    } catch (error) {
        console.error(error);
        loading.classList.add('hidden');
        errorDiv.textContent = 'Error loading schedule. Please try again later.';
        errorDiv.classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', loadSchedule);
