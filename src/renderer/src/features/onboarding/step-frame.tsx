/** A step's frame: its title in the house's voice, what it is for, and its buttons at the bottom. */
export function StepFrame({
  title,
  lead,
  children,
  actions
}: {
  title: string
  lead: React.ReactNode
  children?: React.ReactNode
  actions: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="display-title text-[30px] leading-tight">{title}</h1>
        <p className="voice text-muted-foreground text-[16px] leading-[1.5]">{lead}</p>
      </div>
      {children}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">{actions}</div>
    </div>
  )
}
