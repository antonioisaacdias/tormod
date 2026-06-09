import { Check, ListFilter } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isDefaultView } from '@/lib/sessionView'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import type { SessionFilter, SessionSort, SessionView } from '@/types/sessionView'

const sortOptions: { value: SessionSort; label: string }[] = [
  { value: 'recent', label: 'Recentes' },
  { value: 'name', label: 'Nome' },
  { value: 'node', label: 'Node' },
  { value: 'status', label: 'Status' },
]

const filterOptions: { value: SessionFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'live', label: 'Vivas' },
  { value: 'waiting', label: 'Aguardando' },
  { value: 'closed', label: 'Fechadas' },
]

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
      {children}
    </div>
  )
}

interface OptionProps {
  label: string
  selected: boolean
  onSelect: () => void
}

function Option({ label, selected, onSelect }: OptionProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
        selected ? 'bg-arc/12 text-frost' : 'text-mist hover:bg-raised',
      )}
    >
      {label}
      {selected && <Check className="size-3.5 text-arc" />}
    </button>
  )
}

interface SessionFilterMenuProps {
  view: SessionView
  onChange: (view: SessionView) => void
}

export function SessionFilterMenu({ view, onChange }: SessionFilterMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Filtrar e ordenar sessões"
        className="relative grid size-7 place-items-center rounded-lg text-mist transition-colors hover:bg-raised hover:text-frost"
      >
        <ListFilter className="size-4" />
        {!isDefaultView(view) && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-arc" />
        )}
      </PopoverTrigger>
      <PopoverContent>
        <GroupLabel>Ordenar por</GroupLabel>
        {sortOptions.map((option) => (
          <Option
            key={option.value}
            label={option.label}
            selected={view.sort === option.value}
            onSelect={() => onChange({ ...view, sort: option.value })}
          />
        ))}
        <div className="my-1.5 h-px bg-border" />
        <GroupLabel>Filtrar</GroupLabel>
        {filterOptions.map((option) => (
          <Option
            key={option.value}
            label={option.label}
            selected={view.filter === option.value}
            onSelect={() => onChange({ ...view, filter: option.value })}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
