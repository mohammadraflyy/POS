import { useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** walk-in customer - every sale starts filed under this name */
export const DEFAULT_PELANGGAN = 'UMUM'

export interface CustomerPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the name currently attached to the sale */
  value: string
  /** names used on past sales, most recent first */
  customers: string[]
  onSelect: (namaPelanggan: string) => void
}

export function CustomerPicker({ open, onOpenChange, value, customers, onSelect }: CustomerPickerProps) {
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)

    if (open) {
      setQuery('')
    }
  }

  const typed = query.trim()
  const results = customers.filter((nama) => nama.toLowerCase().includes(typed.toLowerCase()))
  // There is no customer master - a name that has never been used on a sale is
  // simply typed here and becomes one, so the picker doubles as "tambah baru".
  const isNew = typed !== '' && !customers.some((nama) => nama.toLowerCase() === typed.toLowerCase())

  function pick(nama: string) {
    onSelect(nama)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pelanggan"
      description="Pilih pelanggan atau ketik nama baru"
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          // Enter on a brand new name commits it straight away, so a first-time
          // customer costs one field and one key.
          if (e.key === 'Enter' && isNew && results.length === 0) {
            e.preventDefault()
            pick(typed)
          }
        }}
        placeholder="Cari atau ketik nama pelanggan baru..."
      />
      <CommandList>
        <CommandEmpty>Ketik nama untuk menambah pelanggan baru.</CommandEmpty>
        {isNew && (
          <CommandGroup heading="Baru">
            <CommandItem value={`__new__${typed}`} onSelect={() => pick(typed)}>
              <UserPlus className="size-4" />
              Tambah &ldquo;{typed}&rdquo;
            </CommandItem>
          </CommandGroup>
        )}
        {results.length > 0 && (
          <CommandGroup heading="Pelanggan">
            {results.map((nama) => (
              <CommandItem key={nama} value={nama} onSelect={() => pick(nama)}>
                <Check className={nama === value ? 'size-4' : 'size-4 opacity-0'} />
                {nama}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&uarr;&darr;</kbd>
          pilih
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">&crarr;</kbd>
          pakai
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5">esc</kbd>
          tutup
        </span>
      </div>
    </CommandDialog>
  )
}
