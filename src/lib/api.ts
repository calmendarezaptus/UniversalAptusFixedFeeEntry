// Función del proyecto Honorarios fijos (FixedFeesForAptusFinancials): fixed_fee_services.
// Desarrollo usa el proxy de Vite (mismo origen); VITE_API_BASE_URL la reemplaza si se define.
const FALLBACK_API = 'https://fixedfeesforaptusfinancials-730085095.development.catalystserverless.com/server/fixed_fee_services'
export const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || FALLBACK_API).replace(/\/$/, '')

// A dónde regresa "Cancelar" si no llega ?origin= (calendario de honorarios fijos).
export const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL || 'https://universal-fixedfeeentry-calendar.onslate.com/'
