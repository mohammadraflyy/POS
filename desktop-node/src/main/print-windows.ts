import koffi from 'koffi'

/**
 * Raw ESC/POS output straight to the Windows spooler.
 *
 * This used to spawn `powershell.exe` once per receipt to P/Invoke the same functions.
 * Caching the compiled helper DLL removed the C# compile, but PowerShell's own process
 * startup still cost ~300-600 ms on every single struk - that was the whole of the
 * "print lemot" complaint. Calling winspool.drv in-process removes the process entirely.
 */
const winspool = koffi.load('winspool.drv')

const DOC_INFO_1 = koffi.struct('DOC_INFO_1', {
  pDocName: 'str',
  pOutputFile: 'str',
  pDatatype: 'str',
})

const OpenPrinter = winspool.func('__stdcall', 'OpenPrinterA', 'bool', ['str', 'void **', 'void *'])
const ClosePrinter = winspool.func('__stdcall', 'ClosePrinter', 'bool', ['void *'])
const StartDocPrinter = winspool.func('__stdcall', 'StartDocPrinterA', 'int32', ['void *', 'uint32', koffi.pointer(DOC_INFO_1)])
const EndDocPrinter = winspool.func('__stdcall', 'EndDocPrinter', 'bool', ['void *'])
const StartPagePrinter = winspool.func('__stdcall', 'StartPagePrinter', 'bool', ['void *'])
const EndPagePrinter = winspool.func('__stdcall', 'EndPagePrinter', 'bool', ['void *'])
const WritePrinter = winspool.func('__stdcall', 'WritePrinter', 'bool', ['void *', 'void *', 'uint32', 'uint32 *'])

const PRINT_TIMEOUT_MS = 30_000

/**
 * Runs a koffi function on koffi's worker-thread pool instead of the main thread, so a
 * spooler that never answers cannot freeze every ipcMain handler and all better-sqlite3
 * access. `fn.async(...args, cb)` is koffi's own async calling convention - see
 * node_modules/koffi/doc/load.md.
 */
function callAsync<T>(fn: { async: (...args: unknown[]) => void }, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: unknown, res: T) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      } else {
        resolve(res)
      }
    })
  })
}

async function sendToPrinter(printerName: string, data: Buffer): Promise<void> {
  const handleOut = [null] as unknown[]

  if (!(await callAsync<boolean>(OpenPrinter, printerName, handleOut, null))) {
    throw new Error(`printer "${printerName}" tidak bisa dibuka`)
  }

  const handle = handleOut[0]

  try {
    const docInfo = { pDocName: 'POS Receipt', pOutputFile: null, pDatatype: 'RAW' }

    if ((await callAsync<number>(StartDocPrinter, handle, 1, docInfo)) === 0) {
      throw new Error('spooler menolak dokumen baru')
    }

    try {
      if (!(await callAsync<boolean>(StartPagePrinter, handle))) {
        throw new Error('spooler menolak halaman baru')
      }

      try {
        const written = [0]

        if (!(await callAsync<boolean>(WritePrinter, handle, data, data.length, written))) {
          throw new Error('data gagal dikirim ke printer')
        }
      } finally {
        await callAsync(EndPagePrinter, handle)
      }
    } finally {
      await callAsync(EndDocPrinter, handle)
    }
  } finally {
    await callAsync(ClosePrinter, handle)
  }
}

/**
 * Races the actual print against a 30s clock, mirroring the timeout the old
 * `execFile(..., { timeout: 30_000 })` used to give a hung spooler. Koffi has no way to
 * cancel an in-flight async call, so a truly-hung native call keeps running in the
 * background and still releases its handle whenever the OS eventually answers - this
 * timeout only bounds how long the caller waits, same as any FFI/blocking native call.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function runPrint(printerName: string, data: Buffer): Promise<void> {
  try {
    await withTimeout(sendToPrinter(printerName, data), PRINT_TIMEOUT_MS, 'printer tidak merespons dalam 30 detik')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  }
}

// One receipt at a time. The renderer fires prints without awaiting them, so two receipts
// really can overlap - this is not a theoretical race.
let printQueue: Promise<unknown> = Promise.resolve()

export function printRaw(printerName: string, data: Buffer): Promise<void> {
  const run = () => runPrint(printerName, data)
  const next = printQueue.then(run, run)

  printQueue = next.catch(() => undefined)

  return next
}
