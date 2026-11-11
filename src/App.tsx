import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import 'animate.css'
import { Toaster } from 'sonner'
import {
  Briefcase, Calendar as CalendarIcon, CalendarRange, CheckCircle2, CircleDashed, FileText, Info,
  Landmark, PenLine, RefreshCw, Repeat, Save, Sparkles, Wallet,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusModal, type StatusModalType } from '@/components/StatusModal'
import { SearchSelect } from '@/components/SearchSelect'
import { ThemeMenu } from '@/components/ThemeMenu'
import { DescriptionCard } from '@/components/DescriptionCard'
import { AmountPopover } from '@/components/AmountPopover'
import { cn } from '@/lib/utils'
import { CALENDAR_URL } from '@/lib/api'
import { cardCls, gradientBtnCls, inputCls, labelCls, sectionIconCls, sectionTitleCls, useTheme } from '@/lib/ui'
import { loadClientes, loadProyectos, type Cliente, type Proyecto } from '@/lib/catalogs'
import {
  buildCargo, buildUpdate, CONCEPTO_MAX, DEFAULT_CONCEPTO, fetchCargos, formatAmount, generarIgualas, getCargo,
  igualaPreview, isPeriodo, lockReason, saveCargo, TIPO_COBRO_LABEL, type Cargo, type CargoPayload, type CargoUpdate, type TipoCobro,
} from '@/lib/fixedfee'

type Modal = { isOpen: boolean; type: StatusModalType; title: string; message: string }
type Loadable<T> = { rows: T[]; loading: boolean; error: string }
type Mode = 'manual' | 'igualas'
const empty = <T,>(): Loadable<T> => ({ rows: [], loading: false, error: '' })
const isFeeProject = (p: Proyecto) => p.tipo_cobro === 'fijo' || p.tipo_cobro === 'iguala'

function useCatalog<T>(org: string | null, loader: (org: string, force?: boolean) => Promise<T[]>, label: string) {
  const [state, setState] = useState<Loadable<T>>(empty)
  const load = async (force = false) => {
    if (!org) return
    setState(s => ({ ...s, loading: true, error: '' }))
    try { setState({ rows: await loader(org, force), loading: false, error: '' }) }
    catch { setState({ rows: [], loading: false, error: `No se pudieron cargar ${label}.` }) }
  }
  useEffect(() => { void load() }, [org]) // eslint-disable-line react-hooks/exhaustive-deps
  return [state, load] as const
}

const uncertainOf = (error: unknown) => error instanceof Error && 'uncertain' in error && (error as { uncertain?: boolean }).uncertain === true

function App() {
  const [theme, setTheme] = useTheme()
  const [editId] = useState(() => new URLSearchParams(window.location.search).get('cargo_id'))
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [statusModal, setStatusModal] = useState<Modal>({ isOpen: false, type: 'info', title: '', message: '' })

  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get('organization_id')
    if (!orgId) setStatusModal({ isOpen: true, type: 'error', title: 'Error de Inicialización', message: 'No se detectó la organización relacionada. Es necesario incluir el parámetro "organization_id" en la URL.' })
    else setOrganizationId(orgId)
  }, [])

  const [clientes, reloadClientes] = useCatalog<Cliente>(organizationId, loadClientes, 'los clientes')
  const [proyectos, reloadProyectos] = useCatalog<Proyecto>(organizationId, loadProyectos, 'los proyectos')

  const editing = editId !== null
  const [mode, setMode] = useState<Mode>('manual')

  // Formulario del cargo manual
  const [date, setDate] = useState<Date>(new Date())
  const [selectedCliente, setSelectedCliente] = useState('')
  const [selectedProyecto, setSelectedProyecto] = useState('')
  const [amount, setAmount] = useState('0.00')
  const [concepto, setConcepto] = useState('')
  const amountTouched = useRef(false)
  const conceptoTouched = useRef(false)

  // Igualas del mes
  const [periodo, setPeriodo] = useState(() => format(new Date(), 'yyyy-MM'))
  const [cargos, setCargos] = useState<Loadable<Cargo>>(empty)

  // Guardado
  const [isSaving, setIsSaving] = useState(false)
  const [saveBlocked, setSaveBlocked] = useState(false)
  const savingRef = useRef(false)
  const savedFingerprint = useRef('')

  // Edición
  const [editDetail, setEditDetail] = useState<Cargo | null>(null)
  const [editError, setEditError] = useState('')
  const [editReady, setEditReady] = useState(false)

  // Solo proyectos de cuota fija o iguala, y solo los clientes que tienen alguno.
  const feeProjects = useMemo(() => proyectos.rows.filter(isFeeProject), [proyectos.rows])
  const feeClientes = useMemo(() => {
    const ids = new Set(feeProjects.map(p => p.cliente_id))
    return clientes.rows.filter(c => ids.has(c.ID))
  }, [clientes.rows, feeProjects])
  const proyectosCliente = useMemo(() => feeProjects.filter(p => p.cliente_id === selectedCliente)
    .map(p => ({ ...p, secondary: `${TIPO_COBRO_LABEL[p.tipo_cobro as TipoCobro]}${p.honorario_fijo ? ` · ${formatAmount(p.honorario_fijo, p.moneda)}` : ''}` })), [feeProjects, selectedCliente])
  const proyecto = proyectos.rows.find(p => p.ID === selectedProyecto)
  const tipoCobro = (proyecto?.tipo_cobro ?? editDetail?.proyecto_tipo_cobro ?? null) as TipoCobro | null
  const moneda = proyecto?.moneda || editDetail?.moneda || 'MXN'
  const catalogsLoading = clientes.loading || proyectos.loading
  const clienteName = (id: string) => clientes.rows.find(c => c.ID === id)?.display || ''

  // Al elegir proyecto se proponen su honorario y un concepto, mientras el usuario no los haya cambiado.
  useEffect(() => {
    if (!proyecto || editing) return
    if (!amountTouched.current) setAmount(proyecto.honorario_fijo ? proyecto.honorario_fijo.toFixed(2) : '0.00')
    if (!conceptoTouched.current && isFeeProject(proyecto)) setConcepto(DEFAULT_CONCEPTO[proyecto.tipo_cobro as TipoCobro])
  }, [proyecto, editing])

  useEffect(() => {
    if (editId === null || !organizationId) return
    const controller = new AbortController()
    getCargo(organizationId, editId, controller.signal)
      .then(detail => { if (!controller.signal.aborted) setEditDetail(detail) })
      .catch(error => { if (!controller.signal.aborted) setEditError(error instanceof Error ? error.message : 'No se pudo cargar el cargo.') })
    return () => controller.abort()
  }, [editId, organizationId])

  useEffect(() => {
    if (!editDetail || editReady || catalogsLoading || !proyectos.rows.length) return
    const project = proyectos.rows.find(p => p.ID === String(editDetail.proyecto_id))
    if (!project || !clientes.rows.some(c => c.ID === project.cliente_id)) { setEditError('El proyecto o cliente de este cargo no está disponible en Aptus Sync.'); return }
    setSelectedCliente(project.cliente_id)
    setSelectedProyecto(project.ID)
    amountTouched.current = true
    conceptoTouched.current = true
    setAmount(editDetail.monto.toFixed(2))
    setConcepto(editDetail.concepto || '')
    const [y, m, d] = editDetail.fecha.split('-').map(Number)
    setDate(new Date(y, m - 1, d))
    const locked = lockReason(editDetail)
    if (locked) setEditError(locked)
    setEditReady(true)
  }, [editDetail, editReady, catalogsLoading, proyectos.rows, clientes.rows])

  const loadCargos = async () => {
    if (!organizationId) return
    setCargos(s => ({ ...s, loading: true, error: '' }))
    try { setCargos({ rows: await fetchCargos(organizationId), loading: false, error: '' }) }
    catch (error) { setCargos({ rows: [], loading: false, error: error instanceof Error ? error.message : 'No se pudo cargar el listado de honorarios fijos.' }) }
  }
  useEffect(() => { if (mode === 'igualas') void loadCargos() }, [mode, organizationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => isPeriodo(periodo) ? igualaPreview(feeProjects, cargos.rows, periodo) : { nuevos: [], existentes: [] }, [feeProjects, cargos.rows, periodo])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isSaving) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isSaving])

  const editBlocked = editing && (!editReady || !!editError)

  async function run<T>(fingerprintParts: unknown, action: () => Promise<T>, onDone: (result: T) => void, errorTitle: string) {
    if (savingRef.current || saveBlocked || editBlocked) return
    const fingerprint = JSON.stringify(fingerprintParts)
    try {
      if (savedFingerprint.current === fingerprint) throw new Error('Estos datos ya se guardaron. Modifica los campos para registrar uno nuevo.')
      savingRef.current = true
      setIsSaving(true)
      const result = await action()
      savedFingerprint.current = fingerprint
      onDone(result)
    } catch (error) {
      const uncertain = uncertainOf(error)
      if (uncertain) setSaveBlocked(true)
      setStatusModal({ isOpen: true, type: 'error', title: uncertain ? 'Resultado por verificar' : errorTitle, message: error instanceof Error ? error.message : 'Error al guardar.' })
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  async function handleSave() {
    if (!organizationId || !/^\d+$/.test(organizationId)) { setStatusModal({ isOpen: true, type: 'error', title: 'No se completó el guardado', message: 'Falta una organización válida.' }); return }
    let payload: CargoPayload | CargoUpdate
    try {
      if (!editing && !selectedCliente) throw new Error('Selecciona un cliente.')
      const input = { projectId: selectedProyecto, tipoCobro, date: format(date, 'yyyy-MM-dd'), concepto, amount }
      payload = editing ? buildUpdate(input) : buildCargo(input)
    } catch (error) {
      setStatusModal({ isOpen: true, type: 'error', title: 'No se completó el guardado', message: error instanceof Error ? error.message : 'Datos inválidos.' })
      return
    }
    await run([organizationId, editId, payload], () => saveCargo(organizationId, payload, editId ?? undefined), saved => setStatusModal({
      isOpen: true, type: 'success', title: editing ? 'Cargo actualizado' : 'Cargo guardado',
      message: `Se guardó el cargo #${saved.id} "${saved.concepto}" por ${formatAmount(saved.monto, saved.moneda)}. Queda como capturado hasta que se libere.`,
    }), 'No se completó el guardado')
  }

  async function handleGenerar() {
    if (!organizationId || !isPeriodo(periodo)) return
    if (!window.confirm(`Se generará la iguala de ${periodo} para ${preview.nuevos.length} proyecto(s). ¿Continuar?`)) return
    const names = (ids: number[]) => ids.map(id => proyectos.rows.find(p => p.ID === String(id))?.display || `#${id}`).join(', ')
    await run([organizationId, 'igualas', periodo], () => generarIgualas(organizationId, periodo), result => {
      setStatusModal({
        isOpen: true, type: 'success', title: `Igualas de ${result.periodo}`,
        message: `${result.creados.length ? `Creadas: ${names(result.creados)}.` : 'No se creó ninguna iguala nueva.'}${result.ya_existian.length ? ` Ya existían: ${names(result.ya_existian)}.` : ''}`,
      })
      void loadCargos()
    }, 'No se generaron las igualas')
  }

  function handleCancel() {
    const params = new URLSearchParams(window.location.search)
    const org = organizationId || params.get('organization_id') || ''
    try {
      const target = new URL(params.get('origin') || CALENDAR_URL)
      if (!target.searchParams.get('organization_id') && org) target.searchParams.set('organization_id', org)
      target.searchParams.set('_t', Date.now().toString())
      window.location.href = target.toString()
    } catch {
      window.location.href = `${CALENDAR_URL}?organization_id=${encodeURIComponent(org)}&_t=${Date.now()}`
    }
  }

  const amountNumber = Number(amount) || 0
  const stripIcon = 'w-12 h-12 rounded-full bg-white/15 flex items-center justify-center shrink-0 border border-white/25'
  const divider = <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-16 bg-white/20 hidden md:block"></div>
  const igualasMode = mode === 'igualas' && !editing
  const primaryDisabled = editBlocked || isSaving || saveBlocked || catalogsLoading || !organizationId
    || (igualasMode && (cargos.loading || !!cargos.error || preview.nuevos.length === 0))
  const primaryLabel = isSaving ? (igualasMode ? 'Generando…' : 'Guardando…') : saveBlocked ? 'Verificar en el listado'
    : igualasMode ? `Generar igualas (${preview.nuevos.length})` : editing ? 'Guardar cambios' : 'Guardar Cargo'

  return (
    <div className="min-h-screen bg-slate-50/50 p-2 sm:p-4 lg:p-8 flex justify-center items-start font-sans w-full">
      <Toaster position="top-center" richColors />
      <Card className="w-full bg-gradient-to-b from-[#FFFCF5] to-white border border-slate-200 rounded-[20px] overflow-hidden p-3 sm:p-5 lg:p-8 relative animate__animated animate__fadeIn animate__faster">

        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-theme-from/5 rounded-full blur-[80px] animate-blob pointer-events-none z-0"></div>
        <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] bg-theme-to/5 rounded-full blur-[100px] animate-blob animation-delay-2000 pointer-events-none z-0"></div>
        <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-theme-from/5 rounded-full blur-[80px] animate-blob animation-delay-4000 pointer-events-none z-0"></div>
        <div className="absolute top-0 left-0 right-0 h-15 bg-gradient-to-b from-theme-light to-transparent pointer-events-none z-0"></div>

        {/* ── ENCABEZADO ─────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 lg:mb-8 gap-0 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-theme-from to-theme-to flex items-center justify-center shrink-0 shadow-sm border border-black/5 text-white">
              <Landmark className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{editing ? 'Editar cargo fijo' : 'Honorarios Fijos'}</h1>
                <ThemeMenu theme={theme} setTheme={setTheme} />
              </div>
              <p className="text-slate-500 text-sm mt-0.5">Cuotas fijas, hitos e igualas mensuales por proyecto</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mt-4 lg:mt-0 w-full lg:w-auto">
            <Button variant="outline" type="button" onClick={handleCancel}
              className="flex-1 lg:flex-none lg:w-auto h-11 sm:h-12 px-6 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium">
              Cancelar
            </Button>
            <Button onClick={() => void (igualasMode ? handleGenerar() : handleSave())} disabled={primaryDisabled}
              className={cn('flex-1 lg:flex-none lg:w-auto h-11 sm:h-12 px-6 rounded-lg shadow-sm font-medium flex items-center justify-center gap-2 border-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed', gradientBtnCls)}>
              {igualasMode ? <Repeat className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {primaryLabel}
            </Button>
          </div>
        </div>

        {editing && !editReady && !editError && (
          <div role="status" aria-live="polite" className="relative z-10 mb-4 flex items-center gap-3 rounded-xl border border-theme-border bg-theme-light/60 p-4 text-sm text-theme-text">
            <RefreshCw aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" />
            <span>Cargando cargo…</span>
          </div>
        )}
        {editing && editError && <p role="alert" className="relative z-10 mb-4 text-sm text-red-700">{editError}</p>}
        {saveBlocked && <p role="status" className="relative z-10 mb-4 text-sm text-slate-600">La respuesta no pudo confirmarse. Revisa el listado de honorarios fijos antes de recargar para continuar.</p>}
        {[clientes, proyectos].filter(c => c.error).map(c => (
          <p key={c.error} role="alert" className="relative z-10 mb-2 text-xs text-red-700">{c.error}</p>
        ))}
        {!catalogsLoading && proyectos.rows.length > 0 && feeProjects.length === 0 && (
          <p role="status" className="relative z-10 mb-4 text-sm text-slate-600">No hay proyectos de cuota fija ni de iguala. Configura el tipo de cobro del proyecto en Aptus.</p>
        )}

        {/* ── Modo ───────────────────────────────────────────────────────── */}
        {!editing && (
          <div className="relative z-10 mb-4 flex bg-slate-50 p-1 rounded-lg border border-slate-200 w-full sm:w-fit">
            {([
              { key: 'manual', label: 'Cargo manual', hint: 'Cuota fija, anticipo o hito', Icon: PenLine },
              { key: 'igualas', label: 'Igualas del mes', hint: 'Un cargo por proyecto de iguala', Icon: Repeat },
            ] as const).map(({ key, label, hint, Icon }) => (
              <button key={key} type="button" onClick={() => setMode(key)} disabled={isSaving}
                className={cn('min-w-0 flex-1 sm:flex-none flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md transition-all text-left',
                  mode === key ? 'bg-gradient-to-r from-theme-from to-theme-to text-white shadow-sm' : 'text-slate-500 hover:text-theme-text hover:bg-theme-light')}>
                <Icon className={cn('w-4 h-4 shrink-0', mode === key ? 'text-white' : 'text-slate-400')} />
                <span className="flex flex-col leading-tight">
                  <span>{label}</span>
                  <span className={cn('text-[10px] font-medium', mode === key ? 'text-white/80' : 'text-slate-400')}>{hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {igualasMode ? (
          <div inert={isSaving} aria-busy={isSaving} className="space-y-4 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              <div className={cn(cardCls, 'flex flex-col')}>
                <div className="flex items-center gap-2 mb-4">
                  <CalendarRange className={sectionIconCls} />
                  <span className={sectionTitleCls}>Periodo</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="periodo" className={labelCls}>Mes de la iguala *</Label>
                  <input id="periodo" type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                    className={cn(inputCls, 'w-full border px-3 font-medium')} />
                  {!isPeriodo(periodo) && <p role="alert" className="text-xs text-red-700">Selecciona un mes válido.</p>}
                </div>
                <ul className="mt-4 space-y-2 text-xs text-slate-600">
                  <li className="flex gap-2"><span className="text-theme-text font-bold">•</span>Crea un cargo por cada proyecto de iguala con su honorario mensual.</li>
                  <li className="flex gap-2"><span className="text-theme-text font-bold">•</span>Repetirlo para el mismo mes no duplica: los que ya existen se omiten.</li>
                </ul>
              </div>

              <div className={cn(cardCls, 'lg:col-span-2 flex flex-col min-w-0')}>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    <Repeat className={sectionIconCls} />
                    <span className={sectionTitleCls}>Proyectos de iguala</span>
                  </div>
                  <button type="button" onClick={() => void loadCargos()} disabled={cargos.loading} aria-label="Actualizar"
                    className="shrink-0 w-8 h-8 rounded-full border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw className={cn('w-3.5 h-3.5 text-slate-500', cargos.loading && 'animate-spin')} />
                  </button>
                </div>
                {cargos.error && <p role="alert" className="text-xs text-red-700 mb-2">{cargos.error}</p>}
                {cargos.loading || catalogsLoading ? <p className="text-sm text-slate-500">Cargando…</p>
                  : preview.nuevos.length + preview.existentes.length === 0 ? <p className="text-sm text-slate-500">No hay proyectos con iguala mensual.</p>
                  : (
                    <ul className="divide-y divide-slate-100">
                      {[...preview.nuevos.map(p => ({ p, ok: false })), ...preview.existentes.map(p => ({ p, ok: true }))].map(({ p, ok }) => (
                        <li key={p.ID} className="flex items-center gap-3 py-2.5">
                          {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <CircleDashed className="w-4 h-4 text-theme-text shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-800 truncate">{p.display}</p>
                            <p className="text-xs text-slate-500 truncate">{clienteName(p.cliente_id)}</p>
                          </div>
                          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">{p.honorario_fijo ? formatAmount(p.honorario_fijo, p.moneda) : 'Sin honorario'}</span>
                          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap border',
                            ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-theme-text bg-theme-light border-theme-border')}>
                            {ok ? 'Ya generada' : 'Se generará'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </div>
          </div>
        ) : (
          <div inert={isSaving || editBlocked} aria-busy={isSaving} className="space-y-4 relative z-10">

            {/* ── Fecha, cliente y proyecto ──────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              <div className={cn(cardCls, 'flex flex-col')}>
                <div className="flex items-center gap-2 mb-4">
                  <CalendarIcon className={sectionIconCls} />
                  <span className={sectionTitleCls}>Información general</span>
                </div>
                <div className="space-y-2 min-w-0">
                  <Label className={labelCls}>Fecha *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between text-left font-normal border-slate-200 bg-white hover:bg-slate-50 transition-all h-9 rounded-lg text-sm">
                        <span className="text-slate-900 font-medium">{format(date, 'yyyy-MM-dd')}</span>
                        <CalendarIcon className="h-4 w-4 text-slate-400" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[250px] p-0 bg-white shadow-xl rounded-xl border-slate-200 data-[state=open]:animate-[fadeInDown_0.3s_ease-out] data-[state=closed]:animate-[fadeOutUp_0.3s_ease-in]" align="start">
                      <Calendar mode="single" selected={date} onSelect={d => d && setDate(d)} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className={cn(cardCls, 'lg:col-span-2 flex flex-col')}>
                <div className="flex items-center gap-2 mb-4">
                  <Briefcase className={sectionIconCls} />
                  <span className={sectionTitleCls}>Identificación</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 gap-y-4 flex-1">
                  <SearchSelect label="Cliente *" icon={<Briefcase className="w-3.5 h-3.5 text-slate-400" />}
                    options={feeClientes} value={selectedCliente}
                    onChange={id => { setSelectedCliente(id); setSelectedProyecto('') }}
                    loading={clientes.loading || proyectos.loading} disabled={editing} disabledText={clienteName(selectedCliente)}
                    placeholder="Seleccionar cliente" searchPlaceholder="Buscar cliente..." emptyText="Ningún cliente tiene proyectos de cuota fija o iguala."
                    onRefresh={editing ? undefined : () => { void reloadClientes(true); void reloadProyectos(true) }} />
                  <SearchSelect label="Proyecto *" icon={<FileText className="w-3.5 h-3.5 text-slate-400" />}
                    options={proyectosCliente} value={selectedProyecto} onChange={setSelectedProyecto}
                    loading={proyectos.loading} disabled={!selectedCliente || editing}
                    disabledText={editing ? proyecto?.display : 'Selecciona un cliente primero'}
                    placeholder="Seleccionar proyecto" searchPlaceholder="Buscar proyecto..." emptyText="No se encontraron proyectos."
                    onRefresh={editing ? undefined : () => void reloadProyectos(true)} />
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {editing ? 'El proyecto no se puede cambiar: define la moneda del cargo.' : 'Solo aparecen proyectos de cuota fija o iguala mensual.'}
                </p>
              </div>
            </div>

            {/* ── Resumen ─────────────────────────────────────────────────── */}
            <div className="animate__animated animate__fadeIn animate__faster grid grid-cols-1 md:grid-cols-3 gap-0 rounded-xl overflow-hidden shadow-sm bg-gradient-to-r from-theme-from to-theme-to">
              <div className="p-6 flex items-center gap-5 relative">
                <div className={stripIcon}><Wallet className="w-6 h-6 text-white" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white/90 mb-1">Monto *</p>
                  <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-1 min-w-0">
                      <span className="text-2xl font-bold text-white truncate">{formatAmount(amountNumber, '')}</span>
                      <span className="text-sm font-medium text-white/90">{moneda}</span>
                    </div>
                    <AmountPopover value={amount} moneda={moneda} onApply={v => { amountTouched.current = true; setAmount(v) }}
                      triggerClassName="bg-transparent border-white/30 text-white/80 hover:text-white hover:bg-white/20 hover:border-white/50" />
                  </div>
                  {proyecto?.honorario_fijo && amountNumber !== proyecto.honorario_fijo && (
                    <button type="button" onClick={() => { amountTouched.current = false; setAmount(proyecto.honorario_fijo!.toFixed(2)) }}
                      className="mt-1 text-[11px] text-white/80 hover:text-white underline underline-offset-2">
                      Usar el honorario del proyecto ({formatAmount(proyecto.honorario_fijo, moneda)})
                    </button>
                  )}
                </div>
                {divider}
              </div>

              <div className="p-6 flex items-center gap-5 relative">
                <div className={stripIcon}>{tipoCobro === 'iguala' ? <Repeat className="w-6 h-6 text-white" /> : <Landmark className="w-6 h-6 text-white" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white/90 mb-1">Tipo de cobro</p>
                  <span className="text-2xl font-bold text-white">{tipoCobro ? TIPO_COBRO_LABEL[tipoCobro] : '—'}</span>
                  <p className="text-[11px] text-white/80">
                    {tipoCobro === 'iguala' ? 'Las igualas del mes se generan en "Igualas del mes".' : tipoCobro === 'fijo' ? 'Cargo completo o por hitos (p. ej. anticipo 50%).' : 'Selecciona un proyecto.'}
                  </p>
                </div>
                {divider}
              </div>

              <div className="p-6 flex items-center gap-5">
                <div className={stripIcon}><Sparkles className="w-6 h-6 text-white" /></div>
                <div>
                  <p className="text-xs font-semibold text-white/90 mb-1">Honorario del proyecto</p>
                  <span className="text-2xl font-bold text-white">{proyecto?.honorario_fijo ? formatAmount(proyecto.honorario_fijo, '') : '—'}</span>
                  <p className="text-[11px] text-white/80">{proyecto?.honorario_fijo ? moneda : 'Sin honorario configurado'}</p>
                </div>
              </div>
            </div>

            {/* ── Concepto y notas ────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
              <DescriptionCard className="lg:col-span-2" title="Concepto del cargo *" value={concepto} maxLength={CONCEPTO_MAX}
                onChange={v => { conceptoTouched.current = true; setConcepto(v) }}
                placeholder="Ej. Honorarios (cuota fija), Anticipo 50% — constitución de sociedad..." />

              <div className={cn(cardCls, 'min-w-0 flex flex-col self-start')}>
                <div className="flex items-center gap-2 mb-3">
                  <Info className={sectionIconCls} />
                  <span className={cn(sectionTitleCls, 'text-theme-text')}>Antes de guardar</span>
                </div>
                <ul className="space-y-2 text-xs text-slate-600">
                  <li className="flex gap-2"><span className="text-theme-text font-bold">•</span>El cargo se guarda en la moneda del proyecto ({moneda}).</li>
                  <li className="flex gap-2"><span className="text-theme-text font-bold">•</span><span>Para cobrar por hitos, captura un cargo por cada hito con su monto.</span></li>
                  <li className="flex gap-2"><span className="text-theme-text font-bold">•</span><span>Queda como <b>capturado</b> y entra a una Prebill después de liberarse.</span></li>
                </ul>
                {!editing && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['Honorarios (cuota fija)', 'Anticipo 50%', 'Finiquito 50%'].map(text => (
                      <button key={text} type="button" onClick={() => { conceptoTouched.current = true; setConcepto(text) }}
                        className="text-[11px] font-medium px-2 py-1 rounded-md border border-theme-border bg-theme-light text-theme-text hover:bg-theme-border transition-colors">
                        {text}
                      </button>
                    ))}
                  </div>
                )}
                {editDetail && (
                  <div className="mt-4 border border-theme-border bg-theme-light/20 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                    <p><span className="font-semibold text-theme-text">Estado:</span> {editDetail.status}</p>
                    {editDetail.periodo && <p><span className="font-semibold text-theme-text">Iguala de:</span> {editDetail.periodo}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <StatusModal
        isOpen={statusModal.isOpen}
        onClose={statusModal.type === 'error' && !organizationId ? undefined : () => setStatusModal(prev => ({ ...prev, isOpen: false }))}
        type={statusModal.type} title={statusModal.title} message={statusModal.message}
      />
    </div>
  )
}

export default App
