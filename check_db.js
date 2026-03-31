const { inicializarDB, db } = require('./database/init');

(async () => {
    await inicializarDB();
    const plantillas = await db.all('SELECT titulo, recurrencia, id_empleado_default, id_supervisor_default FROM plantillas_tarea ORDER BY fecha_creacion DESC LIMIT 10');
    console.log('--- ULTIMAS PLANTILLAS ---');
    console.table(plantillas);

    const programadas = await db.all('SELECT titulo, id_empleado, id_supervisor FROM tareas_programadas ORDER BY fecha_creacion DESC LIMIT 10');
    console.log('--- ULTIMAS TAREAS PROGRAMADAS (CALENDARIO) ---');
    console.table(programadas);

    process.exit(0);
})();
