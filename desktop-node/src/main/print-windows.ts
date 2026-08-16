import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

// Bump this when the C# below changes - the compiled DLL is cached by name, and a
// stale one would be reused silently.
const HELPER_VERSION = 'v1'
const DLL_PATH = join(tmpdir(), `pos-rawprint-${HELPER_VERSION}.dll`)
const SCRIPT_PATH = join(tmpdir(), `pos-rawprint-${HELPER_VERSION}.ps1`)

// Standard Microsoft-documented "RawPrinterHelper" technique (KB322091):
// P/Invoke winspool.drv directly so the byte buffer reaches the printer
// as-is, datatype "RAW" - no driver-side re-rendering, which is exactly
// what made Electron's webContents.print({silent:true}) unreliable here.
//
// Add-Type used to recompile this class on every single receipt, and that csc
// run was the bulk of the delay. It is now compiled once to a DLL and merely
// loaded on every later print.
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$DataPath,
  [Parameter(Mandatory=$true)][string]$DllPath
)

$ErrorActionPreference = 'Stop'

$source = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytesToPrinter(string szPrinterName, byte[] pBytes)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        int dwWritten;
        bool bSuccess = false;

        di.pDocName = "POS Receipt";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
                if (StartPagePrinter(hPrinter))
                {
                    bSuccess = WritePrinter(hPrinter, pBytes, pBytes.Length, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }

        if (!bSuccess)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
"@

if (-not (Test-Path $DllPath)) {
  Add-Type -TypeDefinition $source -OutputAssembly $DllPath -OutputType Library
}

try {
  Add-Type -Path $DllPath
} catch {
  Remove-Item $DllPath -Force -ErrorAction SilentlyContinue
  Add-Type -TypeDefinition $source -OutputAssembly $DllPath -OutputType Library
  Add-Type -Path $DllPath
}

$bytes = [System.IO.File]::ReadAllBytes($DataPath)
[RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
`

async function runPrint(printerName: string, data: Buffer): Promise<void> {
  const dataPath = join(tmpdir(), `pos-print-${randomUUID()}.bin`)

  writeFileSync(dataPath, data)
  writeFileSync(SCRIPT_PATH, RAW_PRINT_SCRIPT)

  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-PrinterName',
        printerName,
        '-DataPath',
        dataPath,
        '-DllPath',
        DLL_PATH,
      ],
      { timeout: 30_000 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  } finally {
    try {
      unlinkSync(dataPath)
    } catch {
      // best-effort cleanup
    }
  }
}

// One receipt at a time. Two concurrent runs would race to compile the same DLL
// and could interleave on the printer; the renderer now fires prints without
// awaiting them, so overlap is a real possibility rather than a theoretical one.
let printQueue: Promise<unknown> = Promise.resolve()

export function printRaw(printerName: string, data: Buffer): Promise<void> {
  const run = () => runPrint(printerName, data)
  const next = printQueue.then(run, run)

  printQueue = next.catch(() => undefined)

  return next
}
