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

function sendToPrinter(printerName: string, data: Buffer): void {
  const handleOut = [null] as unknown[]

  if (!OpenPrinter(printerName, handleOut, null)) {
    throw new Error(`printer "${printerName}" tidak bisa dibuka`)
  }

  const handle = handleOut[0]

  try {
    const docInfo = { pDocName: 'POS Receipt', pOutputFile: null, pDatatype: 'RAW' }

    if (StartDocPrinter(handle, 1, docInfo) === 0) {
      throw new Error('spooler menolak dokumen baru')
    }

    try {
      if (!StartPagePrinter(handle)) {
        throw new Error('spooler menolak halaman baru')
      }

      try {
        const written = [0]

        if (!WritePrinter(handle, data, data.length, written)) {
          throw new Error('data gagal dikirim ke printer')
        }
      } finally {
        EndPagePrinter(handle)
      }
    } finally {
      EndDocPrinter(handle)
    }
  } finally {
    ClosePrinter(handle)
  }
}

async function runPrint(printerName: string, data: Buffer): Promise<void> {
  try {
    sendToPrinter(printerName, data)
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
