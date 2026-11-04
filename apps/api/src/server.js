import { createApp } from './app.js';
// PRUEBA DE ROLLBACK: crash intencional al arrancar
process.exit(1);

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`api escuchando en :${port}`));
