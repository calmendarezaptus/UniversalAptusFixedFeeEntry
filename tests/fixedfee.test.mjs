import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// Mismo esquema que la captura de gastos: se transpila el módulo TS y se sustituye ./api.
const toModule = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')
const api = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8')
  .replace('import.meta.env.DEV', 'true').replace('import.meta.env.VITE_API_BASE_URL', 'undefined').replace('import.meta.env.VITE_CALENDAR_URL', 'undefined')
const source = fs.readFileSync(new URL('../src/lib/fixedfee.ts', import.meta.url), 'utf8').replace("from './api'", `from '${toModule(api)}'`)
const { buildCargo, buildUpdate, parseAmount, saveCargo, getCargo, generarIgualas, lockReason, igualaPreview } = await import(toModule(source))

const input = { projectId: '24', tipoCobro: 'fijo', date: '2026-11-11', concepto: '  Anticipo 50%  ', amount: '22,500.00' }

test('arma el cargo con ID local entero y concepto recortado', () => {
  assert.deepEqual(buildCargo(input), { proyecto_id: 24, fecha: '2026-11-11', concepto: 'Anticipo 50%', monto: 22500 })
  assert.deepEqual(buildUpdate(input), { fecha: '2026-11-11', concepto: 'Anticipo 50%', monto: 22500 })
})

test('validaciones de formulario', () => {
  for (const patch of [{ projectId: '' }, { tipoCobro: 'horas' }, { tipoCobro: null }, { date: '2026-02-30' }, { concepto: '   ' }, { concepto: 'x'.repeat(201) }, { amount: '0' }, { amount: '1.234' }]) {
    assert.throws(() => buildCargo({ ...input, ...patch }), undefined, JSON.stringify(patch))
  }
  assert.equal(buildCargo({ ...input, tipoCobro: 'iguala' }).proyecto_id, 24)
  assert.equal(parseAmount('45000'), 45000)
})

test('crear usa POST y editar usa PATCH sin proyecto', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ id: 14, monto: 22500, moneda: 'MXN', concepto: 'Anticipo 50%' }) } }
  await saveCargo('636939444', buildCargo(input))
  await saveCargo('636939444', buildUpdate(input), '14')
  assert.equal(calls[0].url, '/api/636939444/cargos-fijos'); assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[1].url, '/api/636939444/cargos-fijos/14'); assert.equal(calls[1].options.method, 'PATCH')
  assert.equal(JSON.parse(calls[1].options.body).proyecto_id, undefined)
})

test('red caída o respuesta sin id bloquean el reenvío; un 409/422 no', async () => {
  globalThis.fetch = async () => { throw new Error('offline') }
  await assert.rejects(saveCargo('1', buildCargo(input)), e => e.uncertain === true)
  globalThis.fetch = async () => ({ ok: true, status: 201, json: async () => ({}) })
  await assert.rejects(saveCargo('1', buildCargo(input)), e => e.uncertain === true)
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: 'El proyecto se cobra por hora', stage: 'validation', outcome_unknown: false }) })
  await assert.rejects(saveCargo('1', buildCargo(input)), e => e.uncertain === false && e.message === 'El proyecto se cobra por hora')
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new Error('html') } })
  await assert.rejects(saveCargo('1', buildCargo(input)), e => e.uncertain === false && /HTTP 404/.test(e.message))
})

test('generar igualas: periodo válido, POST correcto y respuesta validada', async () => {
  await assert.rejects(generarIgualas('1', '2026-13'), e => e.uncertain === false)
  let call
  globalThis.fetch = async (url, options) => { call = { url, options }; return { ok: true, status: 200, json: async () => ({ periodo: '2026-11', creados: [25], ya_existian: [] }) } }
  assert.deepEqual(await generarIgualas('636939444', '2026-11'), { periodo: '2026-11', creados: [25], ya_existian: [] })
  assert.equal(call.url, '/api/636939444/igualas/generar'); assert.deepEqual(JSON.parse(call.options.body), { periodo: '2026-11' })
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })
  await assert.rejects(generarIgualas('1', '2026-11'), e => e.uncertain === true)
})

test('getCargo valida id y forma; candado igual al de la API', async () => {
  await assert.rejects(getCargo('1', 'abc', new AbortController().signal))
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 14, monto: '1', fecha: '2026-11-11', proyecto_id: 24 }) })
  await assert.rejects(getCargo('1', '14', new AbortController().signal), /formato inesperado/)
  assert.equal(lockReason({ facturado: 0, prebill_id: null, status: 'capturado' }), null)
  assert.match(lockReason({ facturado: 0, prebill_id: 9, status: 'en_prebill' }), /Prebill #9/)
  assert.match(lockReason({ facturado: 1, prebill_id: 9, status: 'facturado' }), /facturado/)
})

test('vista previa de igualas: solo proyectos de iguala, separa los que ya tienen cargo del mes', () => {
  const proyectos = [{ ID: '24', tipo_cobro: 'fijo' }, { ID: '25', tipo_cobro: 'iguala' }, { ID: '27', tipo_cobro: 'iguala' }, { ID: '1', tipo_cobro: 'horas' }]
  const cargos = [{ proyecto_id: 25, periodo: '2026-10' }, { proyecto_id: 27, periodo: '2026-11' }, { proyecto_id: 24, periodo: null }]
  const preview = igualaPreview(proyectos, cargos, '2026-11')
  assert.deepEqual(preview.nuevos.map(p => p.ID), ['25'])
  assert.deepEqual(preview.existentes.map(p => p.ID), ['27'])
})
