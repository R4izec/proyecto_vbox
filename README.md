CSF – Monitoreo de Máquinas (Node.js + Express + MongoDB)
CSF – Monitoreo de Máquinas (Node.js + Express + MongoDB)
Descripción
Sistema de monitoreo en tiempo real e históricos CSF. Permite:
• Ver estado y contadores de múltiples máquinas (incluyendo máquinas dobles con LADO A y LADO B).
• Generar informes y Excel con formato estandarizado.
• Guardar automáticamente copias de los informes.
• Consultar históricos por rango de fechas con gráficos y tablas de 30 minutos.
• Administración básica de catálogo de máquinas.
Stack principal: Node.js, Express, MongoDB. Integración de tiempo real vía Wecon V-BOX HTTP API (EU).
Arquitectura
• Servidor: Express con rutas API modulares.
• Base de datos: MongoDB (monitoreo_csf) con colecciones como users, machines, historicos, etc.
• Integración externa: cliente VBoxClient para consultas a Wecon (manejo de límites de petición y caching).
• Front-end: HTML/CSS/JS en /public con páginas dashboard, historicos, informes, login, maquinas.
• Exportacion de Excels: generacion de Excel usando (ExcelJS) genera tanto informe general en de maquinas (Impresion de tabla de monitoreo en el apartado de dashboard) - generacion de informe Excel de cada maquina o uno general de tdos las maquinas (En historicos, genera un informe de cada maquina seleccionada o uno general de todas las maquinas listando las maquinas y mostrando cada maquina en cada hoja del excel). 
• Exportación: generación de Excel (ExcelJS) con convención de nombres y copia local en /exports.
• Graficos:
• Grafico de barras en dashboard, muestra contadores totales de temporada por cada maquina al pasar el cursor por encima despliega cauadro con mas detalles de esa maquina (Nombre, COntador de temporada, Modelo de maquina, Empresa, Prestador, Fecha de inicio, Estado y Conexión)
• Grafico compuesto en historicos, este muestra un grafico de barras con los contadores diarios, una linea acumulativa, que a sumando los contadores diarios
• Grafico lineal detallado, al presionar una barra de dia, despliega un side panel con el detallado, este cuenta con el grafico lineal ascendente con cada punto marcando la produccion de la maquina por tramos de produccion, este quedara estatico si la maquina no esta  
• 
• 
Estructura del proyecto (resumen)
/exports/                 Copias de informes/Excel generados
/middleware/
  loginJWT.js
  requireAuth.js
/public/
  /dashboard/             dashboard.html, dashboard.css, dashboard.js
  /historicos/            vistas y lógica de históricos
  /informes/              listado/visor de informes exportados
  /login/
  /maquinas/
  /src/                   assets compartidos
/routes/
  authRoutes.js
  changesRoutes.js
  email.js
  exports.js
  historyRoutes.js
  maquinasRoutes.js
  monitorRoutes.js
/services/
  audit.js
  db.js
  historyStore.js
  vboxClient.js
.env
server.js
package.json
README.md
Requisitos
• Node.js 18+ (recomendado)
• MongoDB 6+ (local o remoto)
• Credenciales de Wecon V-BOX (región EU)
Instalación y puesta en marcha
1) Clonar e instalar
   npm install
2) .env
    MONGO_URI=mongodb://127.0.0.1:27017/monitoreo_csf
    PORT=3000
    JWT_SECRET=fb381f5c8e4146a2b5ff9a3cd57ac9f2cfe2a22d42a44a1e9d6e8bc49a777c18
    SESSION_TTL_HOURS=2
    NODE_ENV=development
    APP_TZ=America/Santiago
3) Arrancar servidor
   npm run dev
   # o
   npm start
4) Acceder
   Frontend: http://localhost:3000/
   API: bajo prefijo /api/
Scripts de NPM (sugeridos)
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "lint": "eslint ."
}
Rutas principales (API)
• Auth (/api → authRoutes.js): login/refresh/logout con JWT.
• Monitor (/api/monitor → monitorRoutes.js): datos en tiempo real por máquina.
• Históricos (/api/history → historyRoutes.js): lectura por rango; generación de Excel (diario/semanal) con descarga y copia en /exports.
• Máquinas (/api/maquinas → maquinasRoutes.js): CRUD de catálogo.
• Exports/Informes (/api/exports → exports.js): listado de archivos de /exports con metadatos (fecha, usuario, tipo).
• Cambios/Auditoría (/api → changesRoutes.js, services/audit.js): registro de operaciones.
• Email (/api → email.js): envío de correos para compartir informes.
Convenciones de datos y lógica de negocio
Máquinas normales vs. dobles
• Normales: ESTADO EMERGENCIA, FUNCIONANDO, CONTADOR GENERAL.
• Dobles: además LADO A y LADO B. Para históricos, el cálculo se basa en CONTADOR GENERAL (independiente de A/B).
Reglas de informes/Excel (formato por defecto)
• Idioma: español. Estilo limpio. Números con separador de miles.
• Encabezado/resumen:
  - Fecha
  - Emergencias (veces) y Tiempo en emergencia (X h Y min, solo durante producción)
  - Contador del día
  - Inicio producción (HH:mm), Fin producción (HH:mm)
  - Total producción (X h Y min)
  - Promedios globales por hora y por minuto (sobre tiempo efectivo de producción)
• Tabla de 30 min:
  - Columnas: Desde, Hasta, Producido
  - Sin ceros iniciales; recortar filas hasta el primer > 0
  - Ventanas reales; eje X hora local
• Gráfico:
  - Título: Producción 30m – YYYY-MM-DD
  - Línea con puntos y etiqueta numérica en cada punto; eje X HH:mm; datos centrados
• Emergencias:
  - Contar “veces” y sumar “minutos” (mostrar h/min)
Convención de nombres de archivos en /exports
• datos_maquinas_YYYY-MM-DD_HH_mm.xlsx  (informes generales desde dashboard)
• historicos_MF-<NUM>_YYYY-MM-DD_a_YYYY-MM-DD.xlsx  (semanales/diarios por máquina)
Flujo de trabajo típico
1) Dashboard: visualizar estado general y generar informe general (se descarga y se guarda copia en /exports).
2) Históricos: elegir máquina y rango de fechas → tabla y gráfico de 30m → exportar Excel (descarga + copia en /exports).
3) Informes: listar los archivos de /exports con nombre, fecha y acción (ver/descargar); filtro por tipo de informe.
4) Máquinas: mantener catálogo (normales/dobles, tags, nombre MF-xx).
Seguridad
• Autenticación con JWT; middleware requireAuth protege rutas críticas.
• Variables sensibles solo en .env (no versionar).
• Limitar request rate a Wecon; caching en VBoxClient para evitar “exceed_request_limit”.
Auditoría y cambios
• services/audit.js y changesRoutes.js registran acciones clave (crear/editar máquina, exportes, etc.).
Buenas prácticas y rendimiento
• Caching de resultados de históricos para reducir llamadas a la API externa.
• Validación y sanitización de entradas (norm/parseN).
• Manejo de zona horaria: APP_TZ=America/Santiago y eje X en hora local.
Solución de problemas (quick check)
• No lista máquinas en históricos: revisar conexión a Mongo y la colección machines; verificar requireAuth y permisos.
• Descarga con ID en vez de nombre: revisar formateador de nombre en historyRoutes/exports; usar nombre de máquina (MF-xx).
• Copia no aparece en /exports: confirmar permisos del sistema y la variable EXPORT_DIR; crear carpeta si no existe. (modificar para produccion)
• Gráfico sin etiquetas: verificar render en historicos.js (mostrar valores en puntos).
Roadmap (ideas)
• Paginación y búsqueda avanzada de informes.
• Exportación a PDF.
• Dashboard con KPIs comparativos y alertas.
• Despliegue con Jenkins (CI/CD) en entorno local y futuro paso a producción.
