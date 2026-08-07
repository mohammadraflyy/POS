import { execFile } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)

// Standard Microsoft-documented "RawPrinterHelper" technique (KB322091):
// P/Invoke winspool.drv directly so the byte buffer reaches the printer
// as-is, datatype "RAW" - no driver-side re-rendering, which is exactly
// what made Electron's webContents.print({silent:true}) unreliable here.
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$DataPath
)

$ErrorActionPreference = 'Stop'

Add-Type @"
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

$bytes = [System.IO.File]::ReadAllBytes($DataPath)
[RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
`

export async function printRaw(printerName: string, data: Buffer): Promise<void> {
  const id = randomUUID()
  const dataPath = join(tmpdir(), `pos-print-${id}.bin`)
  const scriptPath = join(tmpdir(), `pos-print-${id}.ps1`)

  writeFileSync(dataPath, data)
  writeFileSync(scriptPath, RAW_PRINT_SCRIPT)

  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PrinterName',
      printerName,
      '-DataPath',
      dataPath,
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Gagal mencetak: ${message}`)
  } finally {
    try {
      unlinkSync(dataPath)
    } catch {
      // best-effort cleanup
    }
    try {
      unlinkSync(scriptPath)
    } catch {
      // best-effort cleanup
    }
  }
}
