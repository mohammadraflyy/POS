import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthUser } from '../types'

interface ProductUnitDto {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

interface ProductDto {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  productUnits: ProductUnitDto[]
}

interface CartLine {
  productId: number
  productUnitId: number | null
  qty: number
}

interface SaleDto {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

export function Kasir() {
  const navigate = useNavigate()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [products, setProducts] = useState<ProductDto[]>([])
  const [salesToday, setSalesToday] = useState<SaleDto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [metodePembayaran, setMetodePembayaran] = useState<'tunai' | 'bon'>('tunai')
  const [namaPelanggan, setNamaPelanggan] = useState('')
  const [dibayar, setDibayar] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.api.auth.me().then((result) => {
      if (!result) {
        navigate('/login')
        return
      }
      setUser(result)
    })
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }
    refreshProducts()
    refreshSalesToday()
  }, [user])

  function refreshProducts() {
    window.api.kasir.listProducts().then(setProducts)
  }

  function refreshSalesToday() {
    window.api.kasir.listSalesToday().then(setSalesToday)
  }

  function addToCart(productId: number) {
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === productId && line.productUnitId === null)
      if (existing) {
        return prev.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line))
      }
      return [...prev, { productId, productUnitId: null, qty: 1 }]
    })
  }

  function updateQty(index: number, qty: number) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, qty } : line)))
  }

  function updateUnit(index: number, productUnitId: number | null) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, productUnitId } : line)))
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index))
  }

  function lineProduct(line: CartLine): ProductDto | undefined {
    return products.find((p) => p.id === line.productId)
  }

  function lineHargaJual(line: CartLine): number {
    const product = lineProduct(line)
    if (!product) {
      return 0
    }
    if (line.productUnitId) {
      return product.productUnits.find((unit) => unit.id === line.productUnitId)?.hargaJual ?? 0
    }
    return product.hargaJual
  }

  const total = cart.reduce((sum, line) => sum + line.qty * lineHargaJual(line), 0)
  const dibayarNumber = Number(dibayar) || 0
  const kembalian = Math.max(dibayarNumber - total, 0)

  async function handleCheckout() {
    setError(null)
    setMessage(null)
    try {
      await window.api.kasir.checkout({
        metodePembayaran,
        namaPelanggan: metodePembayaran === 'bon' ? namaPelanggan : null,
        dibayar: metodePembayaran === 'tunai' ? dibayarNumber : null,
        items: cart.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
        })),
      })
      setMessage('Transaksi disimpan.')
      setCart([])
      setNamaPelanggan('')
      setDibayar('')
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal checkout')
    }
  }

  async function handleCancel(saleId: number) {
    setError(null)
    try {
      await window.api.kasir.cancelSale(saleId)
      refreshProducts()
      refreshSalesToday()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    }
  }

  if (!user) {
    return <p>Memuat...</p>
  }

  const filteredProducts = products.filter(
    (product) =>
      product.namaItem.toLowerCase().includes(search.toLowerCase()) ||
      product.kodeItem.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <h1>Kasir</h1>
      <p>
        {user.name}{' '}
        <button
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </button>
      </p>

      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}

      <section>
        <h2>Produk</h2>
        <input placeholder="Cari produk..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <table>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>{product.namaItem}</td>
                <td>{product.satuan}</td>
                <td>Rp{product.hargaJual.toLocaleString('id-ID')}</td>
                <td>Stok: {product.stok}</td>
                <td>
                  <button onClick={() => addToCart(product.id)}>Tambah</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Cart</h2>
        <table>
          <tbody>
            {cart.map((line, index) => {
              const product = lineProduct(line)
              if (!product) {
                return null
              }
              return (
                <tr key={index}>
                  <td>{product.namaItem}</td>
                  <td>
                    {product.productUnits.length > 0 ? (
                      <select
                        value={line.productUnitId ?? ''}
                        onChange={(e) => updateUnit(index, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">{product.satuan}</option>
                        {product.productUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.satuan}
                          </option>
                        ))}
                      </select>
                    ) : (
                      product.satuan
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={line.qty}
                      onChange={(e) => updateQty(index, Number(e.target.value))}
                    />
                  </td>
                  <td>Rp{(line.qty * lineHargaJual(line)).toLocaleString('id-ID')}</td>
                  <td>
                    <button onClick={() => removeLine(index)}>Hapus</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p>Total: Rp{total.toLocaleString('id-ID')}</p>

        <div>
          <label>
            <input
              type="radio"
              checked={metodePembayaran === 'tunai'}
              onChange={() => setMetodePembayaran('tunai')}
            />
            Tunai
          </label>
          <label>
            <input type="radio" checked={metodePembayaran === 'bon'} onChange={() => setMetodePembayaran('bon')} />
            Bon
          </label>
        </div>

        {metodePembayaran === 'tunai' ? (
          <div>
            <label>
              Dibayar
              <input type="number" min={0} value={dibayar} onChange={(e) => setDibayar(e.target.value)} />
            </label>
            <p>Kembalian: Rp{kembalian.toLocaleString('id-ID')}</p>
          </div>
        ) : (
          <label>
            Nama Pelanggan
            <input value={namaPelanggan} onChange={(e) => setNamaPelanggan(e.target.value)} />
          </label>
        )}

        <button onClick={handleCheckout} disabled={cart.length === 0}>
          Checkout
        </button>
      </section>

      <section>
        <h2>Transaksi Hari Ini</h2>
        <table>
          <tbody>
            {salesToday.map((sale) => (
              <tr key={sale.id}>
                <td>#{sale.id}</td>
                <td>{sale.metodePembayaran}</td>
                <td>{sale.status}</td>
                <td>Rp{sale.total.toLocaleString('id-ID')}</td>
                <td>{sale.status === 'selesai' && <button onClick={() => handleCancel(sale.id)}>Batal</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
