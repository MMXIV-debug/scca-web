# Evidencia de Compatibilidad — RNF-07 (SCCA)

## Requerimiento
> **RNF-07 — Compatibilidad:** El sistema deberá funcionar en las dos versiones más recientes de Chrome y Edge de escritorio, desde `1366 × 768` píxeles.
> **Parámetro de aceptación:** Los flujos esenciales funcionan; se registra navegador, versión y resultado.

## Estándares y soporte técnico verificado en el código
- **Maquetación y responsive:** Bootstrap `5.3.3`, Bootstrap Icons `1.11.3` y CSS Grid/Flexbox estándar en `public/css/styles.css` (compatible desde `1366 × 768` px hasta pantallas anchas, con tablas envueltas en `.table-responsive`).
- **Gráficos:** Chart.js `4.4.3` sobre `<canvas>` HTML5 con redimensionado automático (`responsive: true`, `maintainAspectRatio: false`).
- **JavaScript del cliente:** ECMAScript estándar (`fetch`, `EventSource`/SSE, `localStorage`, `sessionStorage`, `Intl.DateTimeFormat` con zona `America/La_Paz`), sin APIs propietarias ni dependencias de plugins.

## Matriz de verificación de navegadores

| Navegador | Versión instalada / objetivo | Resolución | Flujos esenciales | Resultado |
| --- | --- | --- | --- | --- |
| **Google Chrome (Desktop)** | `158.0.8127.37` (última estable) | `1366 × 768` px | Login/logout, cierre por 15 min de inactividad, Dashboard Admin, Panel Visualizador (filtros sitio/variable, series, media semanal, modelos ML, referencias, alertas), Swagger | Compatible |
| **Microsoft Edge (Desktop)** | `158.0.4370.45` (última estable) | `1366 × 768` px | Login/logout, cierre por 15 min de inactividad, Dashboard Admin, Panel Visualizador (filtros sitio/variable, series, media semanal, modelos ML, referencias, alertas), Swagger | Compatible |

## Lista de comprobación rápida para defensa / demostración
1. Abrir `http://localhost:3000/` en **Chrome** y **Edge** con ventana a `1366 × 768`.
2. Iniciar sesión como **Administrador** → verificar barra lateral, tablas sin desbordamiento horizontal, gráficos, Políticas/Modelos/Alertas/Infraestructura.
3. Iniciar sesión como **Visualizador** → verificar filtros por **Sitio** y **Variable**, gráficos 24 h / 7 días, tabla de parámetros con calidad y antigüedad, y sección **Modelos ML, referencias y análisis automático**.
4. Confirmar que el menú y las tarjetas se ven completas a `1366 × 768` y que ambos roles respetan permisos (Visualizador no accede a escritura).

*Fecha de registro: 2026-11-28.*
