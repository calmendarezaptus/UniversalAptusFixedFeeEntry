import { API_BASE } from './api'

export type TipoCobro = 'fijo' | 'iguala'
export const TIPO_COBRO_LABEL: Record<TipoCobro, string> = { fijo: 'Cuota fija', iguala: 'Iguala mensual' }
export const DEFAULT_CONCEPTO: Record<TipoCobro, string> = { fijo: 'Honorarios (cuota fija)', iguala: 'Honorarios (iguala)' }
export const CONCEPTO_MAX = 200

export interface CargoPayload { proyecto_id: number; fecha: string; concepto: string; monto: number }
export type CargoUpdate = Omit<CargoPayload, 'proyecto_id'>

// Lo que devuelve ReportesSandbox para un cargo fijo (campos que usa la interfaz).
export interface Cargo {
  id: number; proyecto_id: number; fecha: string; concepto: string; monto: number; moneda: string
  periodo?: string | null; proyecto_nombre?: string | null; proyecto_tipo_cobro?: string | null
  liberado: number; prebill_id: number | null; facturado: number; status: string
}

export interface IgualasResult { periodo: string; creados: number[]; ya_existian: number[] }

const intId = (value: string | null | undefined) => value && /^\d+$/.test(value) ? Number(value) : null
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export const isPeriodo = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

// Acepta "1234.5", "1,234.50" o "1234". Máximo 2 decimales, sin redondear en silencio.
export function parseAmount(value: string): number {
  const clean = value.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error('El monto debe ser un número con hasta 2 decimales.')
  const amount = Number(clean)
  if (!(amount > 0)) throw new Error('El monto debe ser mayor que cero.')
  return amount
}

export function formatAmount(value: number, moneda = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + (moneda ? ' ' + moneda : '')
}

// La interfaz siempre manda fecha, concepto y monto: los propone a partir del proyecto y el
// usuario los ve antes de guardar (la API también tiene sus propios valores por omisión).
export function buildCargo(input: { projectId?: string | null; tipoCobro?: string | null; date: string; concepto: string; amount: string }): CargoPayload {
  const proyecto_id = intId(input.projectId)
  if (!proyecto_id) throw new Error('Selecciona un proyecto.')
  if (input.tipoCobro !== 'fijo' && input.tipoCobro !== 'iguala') throw new Error('El proyecto se cobra por hora: los honorarios fijos solo aplican a proyectos de cuota fija o iguala.')
  return { proyecto_id, ...buildUpdate(input) }
}

export function buildUpdate(input: { date: string; concepto: string; amount: string }): CargoUpdate {
  if (!isDate(input.date)) throw new Error('Selecciona una fecha válida.')
  const concepto = input.concepto.trim()
  if (!concepto) throw new Error('Escribe el concepto del cargo.')
  if (concepto.length > CONCEPTO_MAX) throw new Error(`El concepto admite como máximo ${CONCEPTO_MAX} caracteres.`)
  return { fecha: input.date, concepto, monto: parseAmount(input.amount) }
}

type Uncertain = Error & { uncertain?: boolean }
const uncertainError = (message: string, uncertain: boolean) => Object.assign(new Error(message), { uncertain }) as Uncertain

async function write(url: string, method: 'POST' | 'PATCH', body: unknown, what: string): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  } catch {
    throw uncertainError(`Se perdió la respuesta. Revisa ${what} antes de repetir la operación.`, true)
  }
  const data = await response.json().catch(() => null)
  // Un 4xx sin JSON (p. ej. la función desplegada no tiene la ruta) no se procesó: es reintentable.
  if (!response.ok && !data && response.status >= 400 && response.status < 500) {
    throw uncertainError(response.status === 404
      ? 'La función de Catalyst no tiene esta ruta (HTTP 404). Despliega la versión actual de fixed_fee_services.'
      : `El servidor rechazó la petición (HTTP ${response.status}).`, false)
  }
  if (!response.ok) {
    const uncertain = data?.outcome_unknown === true || !data?.stage
    throw uncertainError(`${data?.error || 'No se pudo confirmar la operación.'}${uncertain ? ` Revisa ${what} antes de repetirla.` : ''}`, uncertain)
  }
  return data
}

export async function saveCargo(organizationId: string, payload: CargoPayload | CargoUpdate, cargoId?: string): Promise<Cargo> {
  const url = `${API_BASE}/${encodeURIComponent(organizationId)}/cargos-fijos${cargoId ? `/${encodeURIComponent(cargoId)}` : ''}`
  const data = await write(url, cargoId ? 'PATCH' : 'POST', payload, 'el listado de honorarios fijos')
  if (!Number.isInteger(data?.id)) throw uncertainError('No se pudo confirmar el guardado. Revisa el listado de honorarios fijos antes de repetirlo.', true)
  return data as Cargo
}

export async function generarIgualas(organizationId: string, periodo: string): Promise<IgualasResult> {
  if (!isPeriodo(periodo)) throw uncertainError('Selecciona un mes válido.', false)
  const data = await write(`${API_BASE}/${encodeURIComponent(organizationId)}/igualas/generar`, 'POST', { periodo }, 'el listado de honorarios fijos')
  if (!Array.isArray(data?.creados) || !Array.isArray(data?.ya_existian)) throw uncertainError('No se pudo confirmar la generación. Revisa el listado de honorarios fijos.', true)
  return data as IgualasResult
}

export async function getCargo(organizationId: string, cargoId: string, signal: AbortSignal): Promise<Cargo> {
  if (!/^\d+$/.test(cargoId)) throw new Error('El parámetro cargo_id no es válido.')
  const response = await fetch(`${API_BASE}/${encodeURIComponent(organizationId)}/cargos-fijos/${encodeURIComponent(cargoId)}`, { signal })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.id !== Number(cargoId)) throw new Error(data?.error || 'No se pudo cargar el cargo. Comprueba que Catalyst esté actualizado.')
  if (typeof data.monto !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha) || !Number.isInteger(data.proyecto_id)) throw new Error('El cargo recibido tiene un formato inesperado.')
  return data as Cargo
}

export async function fetchCargos(organizationId: string, signal?: AbortSignal): Promise<Cargo[]> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(organizationId)}/cargos-fijos`, { signal })
  const data = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(data)) throw new Error(data?.error || 'No se pudo cargar el listado de honorarios fijos.')
  return data as Cargo[]
}

// La API rechaza (409) editar lo que ya está en una Prebill o facturado; se avisa antes.
export function lockReason(cargo: Pick<Cargo, 'facturado' | 'prebill_id' | 'status'>): string | null {
  if (cargo.facturado === 1 || cargo.status === 'facturado') return 'Este cargo ya está facturado y no se puede editar.'
  if (cargo.prebill_id != null || cargo.status === 'en_prebill') return `Este cargo ya está en la Prebill #${cargo.prebill_id}. Quítalo de la Prebill para editarlo.`
  return null
}

// Qué haría "Generar igualas" para un mes: qué proyectos de iguala ya tienen su cargo y cuáles no.
export function igualaPreview<P extends { ID: string; tipo_cobro: string }>(proyectos: P[], cargos: Pick<Cargo, 'proyecto_id' | 'periodo'>[], periodo: string) {
  const conCargo = new Set(cargos.filter(c => c.periodo === periodo).map(c => String(c.proyecto_id)))
  const igualas = proyectos.filter(p => p.tipo_cobro === 'iguala')
  return { nuevos: igualas.filter(p => !conCargo.has(p.ID)), existentes: igualas.filter(p => conCargo.has(p.ID)) }
}
