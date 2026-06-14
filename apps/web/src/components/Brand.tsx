import { BrandMark } from './BrandMark'

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-arc/15 text-arc ring-1 ring-arc/30">
        <BrandMark className="size-5" />
      </span>
      <div className="leading-tight">
        <div className="text-2xl font-bold tracking-tight text-frost">Tormod</div>
        <div className="text-[11.5px] text-mist">
          o cérebro do <span className="font-mono text-arc">odin</span> · remoto
        </div>
      </div>
    </div>
  )
}
