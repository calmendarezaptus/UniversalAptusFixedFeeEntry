# Honorarios Fijos (Fixed Fee Entry App)

Captura y edición de **cargos fijos** (cuota fija, anticipos, hitos) y generación de **igualas
mensuales**. Mismo stack, componentes y diseño que la captura de gastos y la de tiempos: React +
Vite + TypeScript, Tailwind CSS v4, shadcn/ui (`new-york`, Radix), lucide, sonner, animate.css y
revisión ortográfica con `typo-js`. Tema por omisión **Ámbar** (Tiempos: Navy Blue; Gastos:
Turquesa).

Se comunica con la función de Catalyst `fixed_fee_services` (proyecto Honorarios fijos), que
reenvía a la API de ReportesSandbox (**no escribe en Zoho Books**).

## Qué hace

- **Cargo manual**: cliente y proyecto (solo los de cuota fija o iguala), fecha, concepto y monto.
  Al elegir el proyecto propone su honorario y un concepto; se pueden cambiar.
- **Igualas del mes**: elige el mes, muestra qué proyectos de iguala ya tienen su cargo y cuáles se
  generarán, pide confirmación y llama a `POST /igualas/generar` (idempotente).
- **Edición** con `?cargo_id=`: proyecto fijo; bloqueada si el cargo está en Prebill o facturado.
- Si la respuesta de una escritura se pierde, bloquea reintentos hasta revisar el listado.

## Parámetros de URL

| Parámetro | Uso |
|---|---|
| `organization_id` | **Requerido.** Sin él la app muestra un error y no permite capturar. |
| `cargo_id` | Opcional. Abre el cargo en modo edición (ID local de Aptus). |
| `origin` | Opcional. URL a la que regresa "Cancelar" (normalmente el calendario de honorarios fijos). |

## Llamadas al backend (función `fixed_fee_services`)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/{org}/clientes`, `/{org}/proyectos` | Selectores (caché 12 h en `localStorage`) |
| POST | `/{org}/cargos-fijos` | Alta |
| GET / PATCH | `/{org}/cargos-fijos/{id}` | Edición |
| GET | `/{org}/cargos-fijos` | Vista previa de igualas |
| POST | `/{org}/igualas/generar` | `{ periodo: "YYYY-MM" }` |

## Variables de entorno (opcionales)

| Variable | Por omisión |
|---|---|
| `VITE_API_BASE_URL` | `https://fixedfeesforaptusfinancials-730085095.development.catalystserverless.com/server/fixed_fee_services` |
| `VITE_CALENDAR_URL` | `https://universal-fixedfeeentry-calendar.onslate.com/` |

En desarrollo todas las llamadas pasan por el proxy de Vite `/api`.

## Comandos

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # pruebas de src/lib/fixedfee.ts (node:test)
npm run build    # compilación para la Slate (dist/)
```

## Proyecto

Forma parte del proyecto de Catalyst **Honorarios fijos**. Configuración, despliegue y pendientes:
`03-honorarios-fijos/PROYECTO.md` en el repositorio de trabajo `AptusWidgets`.
