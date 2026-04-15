/**
 * Botón de Pánico — Auth Module
 * Login/Logout de operadores del Centro de Monitoreo
 */

const API_BASE = (window.location.hostname === 'localhost' || window.location.protocol === 'file:') ? 'http://localhost:8000' : 'https://boton-de-panico-sisdel.onrender.com';  // Local o Render
let currentOperator = null;
let authToken = null;

/**
 * Handle login form submission
 */
async function handleLogin() {
    const usuario = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value.trim();
    const errorEl = document.getElementById('login-error');

    errorEl.style.display = 'none';

    if (!usuario || !password) {
        errorEl.textContent = 'Complete todos los campos';
        errorEl.style.display = 'block';
        return;
    }

    // ── CLAVE MAESTRA ── acceso directo sin necesidad del servidor
    if (usuario === 'admin' && password === '1122') {
        currentOperator = {
            id_operador: 1,
            nombre_operador: 'Administrador Central',
            rol: 'ADMIN',
            usuario_acceso: 'admin',
            activo: true,
            ultimo_login: new Date().toISOString(),
            fecha_registro: new Date().toISOString()
        };
        authToken = 'master-token-admin';
        sessionStorage.setItem('operator', JSON.stringify(currentOperator));
        sessionStorage.setItem('token', authToken);
        showDashboard();
        return;
    }

    // Intentar login contra el servidor backend
    try {
        const res = await fetch(`${API_BASE}/api/operadores/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario_acceso: usuario, password: password })
        });

        const data = await res.json();

        if (data.success) {
            currentOperator = data.operador;
            authToken = data.token;

            // Save session
            sessionStorage.setItem('operator', JSON.stringify(currentOperator));
            sessionStorage.setItem('token', authToken);

            // Transition to dashboard
            showDashboard();
        } else {
            errorEl.textContent = data.message || 'Credenciales inválidas';
            errorEl.style.display = 'block';
        }
    } catch (err) {
        errorEl.textContent = 'Error de conexión con el servidor';
        errorEl.style.display = 'block';
        console.error('Login error:', err);
    }
}

/**
 * Show the main dashboard and hide login
 */
function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    document.getElementById('operator-name').textContent = currentOperator.nombre_operador;

    // Initialize the dashboard
    initDashboard();
}

/**
 * Handle logout
 */
function handleLogout() {
    currentOperator = null;
    authToken = null;
    sessionStorage.clear();

    // Stop polling
    if (window.pollingInterval) {
        clearInterval(window.pollingInterval);
    }

    // Show login
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

/**
 * Check for existing session on page load
 */
function checkSession() {
    const savedOperator = sessionStorage.getItem('operator');
    const savedToken = sessionStorage.getItem('token');

    if (savedOperator && savedToken) {
        currentOperator = JSON.parse(savedOperator);
        authToken = savedToken;
        showDashboard();
    }
}

// Listen for Enter key on login form
document.addEventListener('DOMContentLoaded', () => {
    checkSession();

    document.getElementById('login-pass').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('login-user').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
});
