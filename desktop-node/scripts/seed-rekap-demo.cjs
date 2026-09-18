const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const DB_PATH = path.resolve(__dirname, '../dev.sqlite')
const BACKUP_PATH = path.resolve(__dirname, '../dev.sqlite.before-rekap-demo.sqlite')
const MARKER = '[DEMO-REKAP]'
const rupiah = (value) => Math.round(value * 100)

let randomState = 0x51a7c0de
function random() {
  randomState = (1664525 * randomState + 1013904223) >>> 0
  return randomState / 0x100000000
}

function choose(values) {
  return values[Math.floor(random() * values.length)]
}

function localDate(day) {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function localTimestamp(day, hour = 10, minute = 0) {
  const now = new Date()
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), day, hour, minute).getTime() / 1000)
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database tidak ditemukan: ${DB_PATH}`)
  }

  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')

  if (!fs.existsSync(BACKUP_PATH)) {
    await db.backup(BACKUP_PATH)
    console.log(`Cadangan dibuat: ${BACKUP_PATH}`)
  }

  const existing = db.prepare("select count(*) as count from sales where keterangan like ?").get(`${MARKER}%`).count
  if (existing > 0) {
    console.log(`Data demo sudah ada (${existing} transaksi). Tidak ada data yang ditambahkan.`)
    printSummary(db)
    db.close()
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const admin = db.prepare("select id from users where role = 'admin' order by id limit 1").get()
  if (!admin) {
    throw new Error('User admin belum tersedia. Jalankan aplikasi sekali untuk membuat akun admin.')
  }

  const categories = ['Sembako', 'Minuman', 'Makanan Instan', 'Kebutuhan Rumah', 'Rokok & Kopi']
  const units = [
    ['PCS', 'Pieces', 'pcs'],
    ['PAK', 'Pak', 'pak'],
    ['DUS', 'Dus', 'dus'],
    ['BOTOL', 'Botol', 'btl'],
    ['BUNGKUS', 'Bungkus', 'bks'],
    ['SACHET', 'Sachet', 'sch'],
  ]
  const products = [
    { code: 'DMO-BERAS5', barcode: '8997001000011', name: 'Beras Ramos Premium 5 kg', category: 'Sembako', unit: 'PAK', cost: 68000, sell: 75000 },
    { code: 'DMO-MINYAK1', barcode: '8997001000028', name: 'Minyak Goreng 1 Liter', category: 'Sembako', unit: 'BOTOL', cost: 16500, sell: 19000 },
    { code: 'DMO-GULA1', barcode: '8997001000035', name: 'Gula Pasir 1 kg', category: 'Sembako', unit: 'PAK', cost: 15800, sell: 18000 },
    { code: 'DMO-TEH', barcode: '8997001000042', name: 'Teh Celup 25 Kantong', category: 'Minuman', unit: 'DUS', cost: 7200, sell: 9000 },
    { code: 'DMO-AIR', barcode: '8997001000059', name: 'Air Mineral 600 ml', category: 'Minuman', unit: 'BOTOL', cost: 2400, sell: 3500, derived: { unit: 'DUS', conversion: 24, cost: 57600, sell: 68000 } },
    { code: 'DMO-MIE', barcode: '8997001000066', name: 'Mi Instan Goreng', category: 'Makanan Instan', unit: 'BUNGKUS', cost: 2800, sell: 3500, derived: { unit: 'DUS', conversion: 40, cost: 112000, sell: 114000 } },
    { code: 'DMO-BISKUIT', barcode: '8997001000073', name: 'Biskuit Kelapa 300 g', category: 'Makanan Instan', unit: 'BUNGKUS', cost: 8200, sell: 10500 },
    { code: 'DMO-SABUN', barcode: '8997001000080', name: 'Sabun Cuci Piring 750 ml', category: 'Kebutuhan Rumah', unit: 'BOTOL', cost: 12800, sell: 15500 },
    { code: 'DMO-DETERJEN', barcode: '8997001000097', name: 'Deterjen Bubuk 800 g', category: 'Kebutuhan Rumah', unit: 'PAK', cost: 17500, sell: 21000 },
    { code: 'DMO-TISU', barcode: '8997001000103', name: 'Tisu Wajah 200 Lembar', category: 'Kebutuhan Rumah', unit: 'PAK', cost: 10500, sell: 13500 },
    { code: 'DMO-KOPI', barcode: '8997001000110', name: 'Kopi Hitam Sachet', category: 'Rokok & Kopi', unit: 'SACHET', cost: 1700, sell: 2500, derived: { unit: 'PAK', conversion: 10, cost: 17000, sell: 22000 } },
    { code: 'DMO-ROKOK', barcode: '8997001000127', name: 'Rokok Filter 16 Batang', category: 'Rokok & Kopi', unit: 'BUNGKUS', cost: 27000, sell: 30000 },
    // Sengaja salah harga untuk memunculkan rekomendasi harga di bawah modal.
    { code: 'DMO-SUSU', barcode: '8997001000134', name: 'Susu Kental Manis 370 g', category: 'Minuman', unit: 'KALENG', cost: 12000, sell: 11000 },
    { code: 'DMO-SARDEN', barcode: '8997001000141', name: 'Sarden Kaleng 155 g', category: 'Makanan Instan', unit: 'KALENG', cost: 10200, sell: 10800 },
    { code: 'DMO-GARAM', barcode: '8997001000158', name: 'Garam Halus 500 g', category: 'Sembako', unit: 'PAK', cost: 3500, sell: 5000 },
  ]

  const suppliers = [
    ['CV Sumber Pangan Sejahtera', '081234560101', 'Pasar Induk Blok A'],
    ['UD Maju Bersama', '081234560202', 'Jl. Raya Perdagangan 18'],
    ['PT Distribusi Nusantara', '081234560303', 'Kawasan Pergudangan Timur'],
  ]
  const customers = [
    ['Warung Bu Rina', '081298110001', 'Kampung Sukamaju'],
    ['Pak Dedi', '081298110002', 'Jl. Melati'],
    ['Kantin SD Harapan', '081298110003', 'Jl. Pendidikan'],
    ['Toko Anugerah', '081298110004', 'Pasar Lama'],
  ]

  const seed = db.transaction(() => {
    const insertCategory = db.prepare('insert or ignore into categories (nama, created_at, updated_at) values (?, ?, ?)')
    for (const name of categories) insertCategory.run(name, now, now)

    const insertUnit = db.prepare('insert or ignore into units (code, name, symbol, is_active, created_at, updated_at) values (?, ?, ?, 1, ?, ?)')
    for (const unit of [...units, ['KALENG', 'Kaleng', 'klg']]) insertUnit.run(...unit, now, now)

    const categoryId = db.prepare('select id from categories where nama = ?')
    const unitId = db.prepare('select id from units where code = ?')
    const insertProduct = db.prepare(`
      insert or ignore into products
        (kode_item, barcode, nama_item, category_id, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `)
    const getProduct = db.prepare('select id from products where kode_item = ?')
    const insertProductUnit = db.prepare(`
      insert or ignore into product_units
        (product_id, unit_id, parent_unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok,
         is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const getProductUnit = db.prepare('select id from product_units where product_id = ? and unit_id = ?')

    for (const product of products) {
      insertProduct.run(product.code, product.barcode, product.name, categoryId.get(product.category).id, rupiah(product.cost), rupiah(product.sell), now, now)
      const productId = getProduct.get(product.code).id
      const baseUnitId = unitId.get(product.unit).id
      insertProductUnit.run(productId, baseUnitId, null, 1, 1, rupiah(product.sell), rupiah(product.cost), 1, 1, 1, now, now)
      const baseRowId = getProductUnit.get(productId, baseUnitId).id

      if (product.derived) {
        insertProductUnit.run(
          productId,
          unitId.get(product.derived.unit).id,
          baseRowId,
          product.derived.conversion,
          product.derived.conversion,
          rupiah(product.derived.sell),
          rupiah(product.derived.cost),
          0,
          0,
          0,
          now,
          now,
        )
      }
    }

    const insertSupplier = db.prepare(`
      insert into suppliers (nama, telepon, alamat, keterangan, created_at, updated_at)
      select ?, ?, ?, ?, ?, ? where not exists (select 1 from suppliers where nama = ?)
    `)
    for (const supplier of suppliers) insertSupplier.run(...supplier, `${MARKER} supplier`, now, now, supplier[0])

    const insertCustomer = db.prepare(`
      insert into customers (nama, telepon, alamat, keterangan, created_at, updated_at)
      select ?, ?, ?, ?, ?, ? where not exists (select 1 from customers where nama = ?)
    `)
    for (const customer of customers) insertCustomer.run(...customer, `${MARKER} pelanggan`, now, now, customer[0])

    const settingCount = db.prepare('select count(*) as count from store_settings').get().count
    if (settingCount === 0) {
      db.prepare(`
        insert into store_settings
          (nama_toko, alamat, telepon, pesan_footer, printer_name, receipt_width, margin_minimal_persen, created_at, updated_at)
        values (?, ?, ?, ?, null, '58mm', 10, ?, ?)
      `).run('Toko Demo Sejahtera', 'Jl. Niaga No. 12', '021-555-0188', 'Terima kasih sudah berbelanja', now, now)
    }

    const getSupplier = db.prepare('select id from suppliers where nama = ?')
    const getCustomer = db.prepare('select id from customers where nama = ?')
    const getProductInfo = db.prepare('select id, harga_pokok, harga_jual from products where kode_item = ?')
    const getUnitInfo = db.prepare(`
      select pu.id, pu.conversion_factor, pu.harga_pokok, pu.harga_jual, u.code
      from product_units pu join units u on u.id = pu.unit_id
      where pu.product_id = ? and u.code = ?
    `)

    const insertPurchase = db.prepare(`
      insert into purchases (supplier_id, user_id, tanggal, total, dibayar, catatan, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertPurchaseItem = db.prepare(`
      insert into purchase_items
        (purchase_id, product_id, product_unit_id, qty, konversi, satuan, harga_beli, subtotal, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMovement = db.prepare(`
      insert into stock_movements
        (product_id, product_unit_id, quantity, conversion_factor, base_quantity, movement_type, reference_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const changeStock = db.prepare('update products set stok = round(stok + ?, 3), updated_at = ? where id = ?')

    const purchaseGroups = [
      ['CV Sumber Pangan Sejahtera', 2, products.slice(0, 5)],
      ['UD Maju Bersama', 5, products.slice(5, 10)],
      ['PT Distribusi Nusantara', 9, products.slice(10, 15)],
      ['CV Sumber Pangan Sejahtera', 13, [products[1], products[2], products[5], products[11]]],
    ]

    for (let index = 0; index < purchaseGroups.length; index++) {
      const [supplierName, day, group] = purchaseGroups[index]
      const lines = group.map((product) => {
        const row = getProductInfo.get(product.code)
        const unit = getUnitInfo.get(row.id, product.unit)
        const qty = product.code === 'DMO-ROKOK' ? 240 : 80 + Math.floor(random() * 70)
        return { row, unit, qty, subtotal: qty * row.harga_pokok }
      })
      const total = lines.reduce((sum, line) => sum + line.subtotal, 0)
      const paid = index === 2 ? Math.round(total * 0.65) : total
      const createdAt = localTimestamp(day, 8, 30)
      const purchaseId = Number(insertPurchase.run(getSupplier.get(supplierName).id, admin.id, localDate(day), total, paid, `${MARKER} stok awal ${index + 1}`, createdAt, createdAt).lastInsertRowid)

      for (const line of lines) {
        insertPurchaseItem.run(purchaseId, line.row.id, line.unit.id, line.qty, 1, line.unit.code, line.row.harga_pokok, line.subtotal, createdAt, createdAt)
        changeStock.run(line.qty, now, line.row.id)
        insertMovement.run(line.row.id, line.unit.id, line.qty, 1, line.qty, 'purchase', purchaseId, createdAt)
      }
    }

    const insertSale = db.prepare(`
      insert into sales
        (user_id, customer_id, nama_pelanggan, metode_pembayaran, status, diskon, total, dibayar, keterangan, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSaleItem = db.prepare(`
      insert into sale_items
        (sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok,
         price_source, diskon, subtotal, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    function addSale({ day, method, customerName = null, lines, noteDiscount = 0, status = 'selesai', label }) {
      const createdAt = localTimestamp(day, 9 + Math.floor(random() * 10), Math.floor(random() * 60))
      const resolved = lines.map((line) => {
        const product = products.find((item) => item.code === line.code)
        const productRow = getProductInfo.get(line.code)
        const unit = getUnitInfo.get(productRow.id, line.unit || product.unit)
        const price = line.price == null ? unit.harga_jual : rupiah(line.price)
        const discount = rupiah(line.discount || 0)
        return { productRow, unit, qty: line.qty, price, discount, subtotal: line.qty * price - discount }
      })
      const total = resolved.reduce((sum, line) => sum + line.subtotal, 0) - rupiah(noteDiscount)
      const customer = customerName ? getCustomer.get(customerName) : null
      const paid = method === 'bon' && label.includes('belum lunas') ? Math.round(total * 0.25) : total
      const saleId = Number(insertSale.run(admin.id, customer?.id ?? null, customerName, method, status, rupiah(noteDiscount), total, paid, `${MARKER} ${label}`, createdAt, createdAt).lastInsertRowid)

      for (const line of resolved) {
        const baseQty = line.qty * line.unit.conversion_factor
        insertSaleItem.run(saleId, line.productRow.id, line.unit.id, line.qty, line.unit.conversion_factor, baseQty, line.unit.code, line.price, line.unit.harga_pokok, 'normal', line.discount, line.subtotal, createdAt, createdAt)
        changeStock.run(-baseQty, now, line.productRow.id)
        insertMovement.run(line.productRow.id, line.unit.id, -line.qty, line.unit.conversion_factor, -baseQty, 'sale', saleId, createdAt)

        if (status === 'dibatalkan') {
          changeStock.run(baseQty, now, line.productRow.id)
          insertMovement.run(line.productRow.id, line.unit.id, line.qty, line.unit.conversion_factor, baseQty, 'sale_cancel', saleId, createdAt + 60)
        }
      }

      return { saleId, total, paid, createdAt }
    }

    const normalProducts = products.filter((product) => !['DMO-SUSU', 'DMO-MIE', 'DMO-ROKOK'].includes(product.code))
    const methods = ['tunai', 'tunai', 'tunai', 'qris', 'transfer']
    const maxDay = Math.max(2, new Date().getDate())
    for (let index = 0; index < 24; index++) {
      const lineCount = 1 + Math.floor(random() * 3)
      const chosen = []
      while (chosen.length < lineCount) {
        const product = choose(normalProducts)
        if (!chosen.some((line) => line.code === product.code)) chosen.push({ code: product.code, qty: 1 + Math.floor(random() * 4) })
      }
      addSale({
        day: 1 + (index % maxDay),
        method: choose(methods),
        customerName: random() > 0.65 ? choose(customers)[0] : null,
        lines: chosen,
        label: `transaksi acak ${String(index + 1).padStart(2, '0')}`,
      })
    }

    addSale({ day: Math.min(6, maxDay), method: 'tunai', lines: [{ code: 'DMO-SUSU', qty: 4 }], label: 'uji harga jual di bawah modal' })
    addSale({ day: Math.min(10, maxDay), method: 'tunai', lines: [{ code: 'DMO-MIE', unit: 'DUS', qty: 2 }], label: 'uji margin satuan tipis' })
    addSale({
      day: Math.min(14, maxDay),
      method: 'tunai',
      customerName: 'Toko Anugerah',
      lines: [{ code: 'DMO-ROKOK', qty: 120, discount: 345000 }],
      noteDiscount: 10000,
      label: 'uji diskon memakan margin',
    })
    addSale({
      day: Math.min(15, maxDay),
      method: 'bon',
      customerName: 'Warung Bu Rina',
      lines: [{ code: 'DMO-BERAS5', qty: 3 }, { code: 'DMO-MINYAK1', qty: 6 }],
      label: 'bon belum lunas',
    })
    const paidBon = addSale({
      day: Math.min(4, maxDay),
      method: 'bon',
      customerName: 'Kantin SD Harapan',
      lines: [{ code: 'DMO-MIE', qty: 20 }, { code: 'DMO-AIR', qty: 24 }],
      label: 'bon lunas bulan ini',
    })
    db.prepare(`insert into bon_payments (sale_id, jumlah, tanggal, keterangan, created_at, updated_at) values (?, ?, ?, ?, ?, ?)`)
      .run(paidBon.saleId, paidBon.total, localDate(Math.min(16, maxDay)), `${MARKER} pelunasan`, localTimestamp(Math.min(16, maxDay), 13), localTimestamp(Math.min(16, maxDay), 13))
    addSale({ day: Math.min(17, maxDay), method: 'tunai', lines: [{ code: 'DMO-TISU', qty: 2 }], status: 'dibatalkan', label: 'transaksi dibatalkan' })

    const insertExpense = db.prepare(`
      insert into cash_expenses (user_id, tanggal, kategori, jumlah, keterangan, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const [day, category, amount, note] of [
      [3, 'Listrik', 450000, 'Token listrik toko'],
      [8, 'Transportasi', 85000, 'Bensin ambil barang'],
      [12, 'Karyawan', 750000, 'Kasbon pegawai'],
      [16, 'Perlengkapan', 125000, 'Plastik dan kertas struk'],
    ]) {
      const timestamp = localTimestamp(Math.min(day, maxDay), 15)
      insertExpense.run(admin.id, localDate(Math.min(day, maxDay)), category, rupiah(amount), `${MARKER} ${note}`, timestamp, timestamp)
    }
  })

  seed()
  printSummary(db)
  db.close()
}

function printSummary(db) {
  const now = new Date()
  const from = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
  const to = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000) - 1
  const counts = {}
  for (const table of ['products', 'suppliers', 'customers', 'purchases', 'sales', 'cash_expenses']) {
    counts[table] = db.prepare(`select count(*) as count from ${table}`).get().count
  }

  const period = db.prepare(`
    select
      count(distinct s.id) as transactions,
      coalesce(sum(si.qty * si.harga_jual), 0) as gross,
      coalesce(sum(si.diskon), 0) + coalesce((select sum(diskon) from sales where status = 'selesai' and created_at between ? and ?), 0) as discounts,
      coalesce(sum(si.qty * si.harga_pokok), 0) as cost,
      sum(case when si.harga_jual < si.harga_pokok then 1 else 0 end) as belowCostLines
    from sales s join sale_items si on si.sale_id = s.id
    where s.status = 'selesai' and s.metode_pembayaran <> 'bon' and s.created_at between ? and ?
  `).get(from, to, from, to)
  const catalogBelowMargin = db.prepare(`
    select count(*) as count
    from product_units pu
    where pu.harga_jual > 0 and pu.harga_pokok > 0 and pu.harga_jual * 90 < pu.harga_pokok * 100
  `).get().count

  console.log('Data demo Rekap siap digunakan.')
  console.table(counts)
  console.log({
    periode: `${localDate(1)} s.d. ${localDate(now.getDate())}`,
    transaksiPeriode: period.transactions,
    barisHargaDiBawahModal: period.belowCostLines,
    diskon: `Rp${Math.round(period.discounts / 100).toLocaleString('id-ID')}`,
    labaSebelumDiskon: `Rp${Math.round((period.gross - period.cost) / 100).toLocaleString('id-ID')}`,
    katalogDiBawahMarginMinimal: catalogBelowMargin,
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
