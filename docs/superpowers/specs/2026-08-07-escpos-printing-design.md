# ESC/POS Raw Printing (Phase 2) — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Replaces the current dialog-based print flow (`webContents.print({silent: false, ...})`, a stopgap after `silent: true` was found to produce blank/tiny output on this printer driver — see git history) with true silent printing via raw ESC/POS bytes sent directly to the printer, bypassing Chromium's print pipeline entirely. Adds a printer-selection and paper-width setting to the Settings page (Phase 1), plus a Test Print tool.

## Why

`silent: true` printing through Electron's `webContents.print()` reliably produced blank or tiny output on the target thermal printer, even after trying `pageSize`, `dpi`, `scaleFactor`, and `margins` — a known category of Electron/Chromium silent-print bug. The interim fix (`silent: false`, showing a native OS print dialog) works but requires a cashier to click "Print" on every sale, which isn't acceptable for a real checkout flow. This phase replaces that entire mechanism with raw ESC/POS printing, which sidesteps Chromium's print pipeline (and its bugs) completely.

Separately, the printer-mismatch bug that started this investigation (system default printer was 80mm hardware; the app's CSS assumed 58mm) exposed that there was no way to configure which printer or paper width the app targets — this phase adds both as explicit settings.

## 1. Why Not `node-thermal-printer`

Investigated and rejected. `node-thermal-printer` itself is pure JS with no native dependencies, but on Windows it needs a system printer to be targeted by name, which requires its optional `printer` driver package. That package was spiked directly in this repo: `npm install printer` fails immediately — before even reaching native compilation — because it depends on `grunt-node-gyp`, which requires `grunt@~0.4` (2013-era), conflicting with npm's dependency resolver against this project's `grunt@1.6.3`. The package's own docs describe compatibility with "node-webkit v0.8.x" (a 2013-2014-era NW.js precursor) and it carries 119 open GitHub issues. Pulling in `node-thermal-printer` anyway would mean adding dependencies for barcode/QR/image printing (`pngjs`, `unorm`, `iconv-lite`) this receipt doesn't use, while still needing a custom Windows transport regardless — so there's no benefit to including it.

## 2. Architecture

Two new pure-TypeScript modules in `main/`, zero new npm dependencies:

- **`main/escpos.ts`** — `buildReceiptEscPos(receipt, storeSettings, paperWidth): Buffer`. A pure function building raw ESC/POS command bytes for a receipt, mirroring `Receipt.tsx`'s current layout exactly (see §4). Fully unit-testable — no I/O.
- **`main/print-windows.ts`** — `printRaw(printerName: string, data: Buffer): Promise<void>`. Writes `data` to a temp file, writes an embedded PowerShell script (the standard Microsoft-documented `winspool.drv` P/Invoke "RawPrinterHelper" technique — `OpenPrinter`/`StartDocPrinter`/`StartPagePrinter`/`WritePrinter`/`EndPagePrinter`/`EndDocPrinter`/`ClosePrinter`, sending the file's raw bytes with datatype `"RAW"`) to another temp file, and shells out via `child_process.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-PrinterName', printerName, '-DataPath', dataPath])`. Both temp files are deleted in a `finally` block regardless of outcome. If the PowerShell script fails (e.g. printer name not found), it writes to stderr and exits non-zero; `printRaw` surfaces that as a rejected promise with a user-facing message. This module is Windows-only — matches the app's existing implicit Windows-only posture (no cross-platform branching exists anywhere in `desktop-node`).

Zero new npm dependencies: `child_process`/`fs`/`os`/`path` are Node builtins, PowerShell ships with Windows, and printer listing uses Electron's own built-in `webContents.getPrintersAsync()`.

## 3. Store Settings: Printer + Paper Width

Two new nullable/defaulted columns on `store_settings`:
- `printer_name: text` (nullable) — the Windows printer's driver name (matches the `name` field from `getPrintersAsync()`, not `displayName`). `null` means "use the OS default printer," resolved at print time via the `isDefault` flag from `getPrintersAsync()`.
- `receipt_width: text` (`'58mm' | '80mm'`, not null, default `'58mm'`) — matches the originally-documented EPPOS EP58M printer size. This dev machine's confirmed 80mm hardware is a per-store setting change, not a new global default.

New migration generated via `npm run db:generate` after the schema edit — following this project's established migration workflow.

`updateStoreSettings`'s signature and validation extend to include `printerName: string | null` (no length limit needed — Windows printer names are OS-bounded) and `receiptWidth: '58mm' | '80mm'` (must be exactly one of these two values, reject anything else). `getStoreSettings`'s return shape gains the same two fields.

New IPC handler `kasir:listPrinters()` → `getPrintersAsync()` mapped to `{name: string, displayName: string, isDefault: boolean}[]`, requiring auth like every other handler.

## 4. ESC/POS Receipt Layout

`buildReceiptEscPos` mirrors `Receipt.tsx` section-for-section:

1. `ESC @` (initialize printer — resets any prior state).
2. Centered, bold: store name. Then centered (not bold): address (if set), phone (if set).
3. Dashed separator line (`-` repeated to the paper's character width).
4. Left-aligned: `Struk #{id}` / formatted date on one line (right-aligned date via padding — matches the current `flex justify-between` look); `Kasir` / kasir name (if known).
5. Dashed separator.
6. Per item: item name on its own line, then `{qty} {satuan} x {harga}` left / `{subtotal}` right (padded to fill the line).
7. Dashed separator.
8. Bold: `TOTAL` left / total right.
9. If `tunai`: `Tunai` / amount paid, then `Kembali` / change — both padded left/right. If `bon`: `Bon` / customer name.
10. If a footer message is set: dashed separator, then centered footer text.
11. Feed 3 blank lines, then a full paper cut (`GS V 0`).

**Character width:** 32 columns for `58mm`, 48 columns for `80mm` (Font A defaults for these two physical widths — standard across ESC/POS thermal printer documentation). A shared `padLine(left, right, width)` helper right-pads/truncates to build the two-column look; a `centerLine(text, width)` helper centers store name/address/footer.

**Encoding:** plain ASCII (`Buffer.from(text, 'ascii')`). Every current piece of receipt copy — store name, address, phone, footer, item names, "Struk"/"Kasir"/"TOTAL"/"Tunai"/"Kembali"/"Bon", and `formatRupiah`'s output (which already strips its Unicode non-breaking space) — is ASCII-only today. A future non-ASCII store name or footer would print mangled bytes; not a concern for this app's current Indonesian-with-ASCII-only copy, and out of scope to solve preemptively.

## 5. `printReceipt` IPC: Signature Change

`kasir:printReceipt` changes from `printReceipt()` (capture whatever's currently rendered on screen) to `printReceipt(saleId: number)`. The handler:
1. Requires auth (unchanged pattern).
2. Re-derives the full receipt server-side via the existing `getReceipt` helper (looking up the sale's `userId` → kasir name, same as `kasir:getReceiptForSale` already does) — the renderer never sends receipt content, only a `saleId`, consistent with this codebase's existing trust boundary (nothing client-computed is trusted for money-relevant output).
3. Reads `store_settings` for store info + `printerName`/`receiptWidth`.
4. Resolves the target printer name: the saved `printerName`, or (if null) the `getPrintersAsync()` entry with `isDefault: true`.
5. Builds ESC/POS bytes via `buildReceiptEscPos` and sends via `printRaw`.

## 6. Dead Code Removal

Once nothing calls `webContents.print()` on a rendered page, these become genuinely unused and are deleted as part of this work (not left as unreferenced cruft):
- `src/renderer/pages/kasir/Receipt.tsx` — the whole component.
- The `.receipt-print` / `@media print` / `@page` block in `src/renderer/assets/main.css`.
- The `kasir:getReceiptForSale` IPC handler, its preload entry, and its `env.d.ts` type — its only caller (`KasirHistory.tsx`'s reprint flow) simplifies to calling `printReceipt(saleId)` directly, since the main process now re-derives the receipt itself.

In `Kasir.tsx` and `KasirHistory.tsx`: the `storeSettings` state and its `getStoreSettings()` fetch are removed (they existed solely to feed `<Receipt>`). The `receiptSale` state (previously holding the full fetched receipt object, used both to trigger printing and to render `<Receipt>`) is replaced by a much smaller `printingSaleId: number | null`, used only to (a) call `printReceipt(printingSaleId)` when it's set, and (b) drive `PaymentDialog`'s existing `printing={printingSaleId !== null}` prop in `Kasir.tsx`. `KasirHistory.tsx`'s `printSale(saleId)` simplifies to directly awaiting `printReceipt(saleId)` — no more pre-fetch step.

`checkout`'s return payload (still the full `getReceipt`-shaped object) is left unchanged — trimming it to just `{saleId, total}` would be a reasonable follow-on simplification, but touches an already-reviewed, tested code path for no functional benefit in this phase, so it's out of scope here.

## 7. Test Print

New `TestPrint` section in `Settings.tsx`, parallel to the existing `TestScan`: a button that sends a fixed sample receipt (matching the web app's `dummySale()` precedent — a canned example, not a real sale) through the exact same `printReceipt`-adjacent pipeline, using the **currently saved** printer/width settings (not unsaved in-progress form edits — the user must Save first, matching how the web app's Test Print is independent of the store-info form's typed-but-unsaved state). Since this doesn't correspond to a real `sales` row, it needs a small variant entry point — `kasir:testPrint()` — that builds ESC/POS bytes from a hardcoded sample `ReceiptSale`-shaped object directly (bypassing the `saleId` lookup) but otherwise goes through the same `buildReceiptEscPos`/`printRaw` path, using the current saved `printerName`/`receiptWidth`/store info.

## Out of Scope

- Barcode/QR/image printing on the receipt.
- Cross-platform (macOS/Linux) printing — Windows-only, matching the app's existing implicit posture.
- Auto-detecting paper width from the printer driver (rejected earlier in this project's history — driver names aren't standardized enough to trust).
- Trimming `checkout`'s IPC return payload (see §6).
- A print queue/retry mechanism — matches the current app's "one print job, fails loud if it fails" behavior.
