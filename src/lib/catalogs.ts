import { API_BASE } from './api'

// Catálogos de Aptus (ReportesSandbox vía la función de Catalyst), con caché en localStorage
// de 12 h por organización, igual que la captura de tiempos.
const TTL_MS = 12 * 60 * 60 * 1000

export interface Option { ID: string; display: string; secondary?: string; fotoUrl?: string }
export interface Cliente extends Option { zoho_id: string | null }
export interface Proyecto extends Option { cliente_id: string; moneda: string; tipo_cobro: string; honorario_fijo: number | null; zoho_id: string | null }

function readCache<T>(key: string): T | null {
  try {
    const data = localStorage.getItem(key)
    const time = localStorage.getItem(key + '_timestamp')
    if (data && time && Date.now() - parseInt(time, 10) < TTL_MS) return JSON.parse(data) as T
  } catch { /* caché corrupta o bloqueada */ }
  return null
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    localStorage.setItem(key + '_timestamp', Date.now().toString())
  } catch { /* sin almacenamiento */ }
}

async function fetchList(org: string, catalog: string, signal?: AbortSignal): Promise<any[]> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(org)}/${catalog}`, { signal })
  if (!response.ok) throw new Error(`Error HTTP: ${response.status}`)
  const data = await response.json().catch(() => null)
  if (!Array.isArray(data)) throw new Error(`El catálogo de ${catalog} tiene un formato inesperado.`)
  return data
}

const isActive = (r: any) => r.activo === undefined ? r.status === 'activo' || r.status === 'active' || r.status === undefined : Number(r.activo) === 1

async function cached<T>(org: string, key: string, catalog: string, map: (rows: any[]) => T[], force: boolean): Promise<T[]> {
  const cacheKey = `${key}_v1_${org}`
  if (!force) {
    const hit = readCache<T[]>(cacheKey)
    if (hit) return hit
  }
  const mapped = map(await fetchList(org, catalog))
  writeCache(cacheKey, mapped)
  return mapped
}

export const loadClientes = (org: string, force = false) => cached<Cliente>(org, 'clientes_cache', 'clientes', rows => rows.map(r => ({
  ID: String(r.id), zoho_id: r.zoho_id == null ? null : String(r.zoho_id), display: r.nombre,
})), force)

export const loadProyectos = (org: string, force = false) => cached<Proyecto>(org, 'all_proyectos_cache', 'proyectos', rows => rows.filter(isActive).map(r => ({
  ID: String(r.id), display: r.nombre_completo || r.nombre,
  cliente_id: String(r.cliente_id ?? r.cliente_zoho_id ?? ''),
  moneda: r.moneda || 'MXN', tipo_cobro: r.tipo_cobro || 'horas',
  honorario_fijo: r.honorario_fijo == null ? null : Number(r.honorario_fijo),
  zoho_id: r.zoho_id == null ? null : String(r.zoho_id),
})), force)
