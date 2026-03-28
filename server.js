require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { inicializarDB } = require('./database/init');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Crear carpeta uploads si no existe
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Inicializar base de datos (async para PostgreSQL)
(async () => {
    try {
        await inicializarDB();
    } catch(err) {
        console.error('❌ Error inicializando BD:', err);
        process.exit(1);
    }
})();

// Socket.IO - conexiones en tiempo real
io.on('connection', (socket) => {
    console.log('🔌 Cliente conectado:', socket.id);

    socket.on('unirse_empresa', (id_empresa) => {
        socket.join(`empresa_${id_empresa}`);
        console.log(`📡 Socket ${socket.id} unido a empresa ${id_empresa}`);
    });

    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
    });
});

// Hacer io accesible en las rutas
app.set('io', io);

// Rutas API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/empresas', require('./routes/empresas'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/tareas', require('./routes/tareas'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/auditoria', require('./routes/auditoria'));
app.use('/api/plantillas', require('./routes/plantillas'));
app.use('/api/asistencia', require('./routes/asistencia'));

// Ruta principal - SPA
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  🏢 GESTIÓN LABORAL - Sistema SaaS');
    console.log(`  🌐 Servidor corriendo en puerto ${PORT}`);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
    console.log('');

    // Cron job: cada 5 minutos verificar plantillas repetitivas y tareas programadas
    const { ejecutarCronPlantillas } = require('./routes/plantillas');
    setInterval(() => ejecutarCronPlantillas(io), 5 * 60 * 1000);
    // Ejecutar una vez al iniciar
    setTimeout(() => ejecutarCronPlantillas(io), 10000);
    console.log('⏰ Cron de plantillas activado (cada 5 min)');
});
