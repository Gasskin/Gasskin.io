import { CircleHelp } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function SettingsToggleRow({
  label,
  help,
  checked,
  onChange
}: {
  label: string
  help?: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      className="toggle-row flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60"
      type="button"
      onClick={onChange}
    >
      <span className="field-label-with-help flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        {help ? (
          <span
            className="info-icon inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title={help}
            aria-label={`${label}说明`}
          >
            <CircleHelp size={14} />
          </span>
        ) : null}
      </span>
      <Switch
        checked={checked}
        aria-label={label}
        className={cn('pointer-events-none shrink-0', checked ? '' : 'off')}
      />
    </button>
  )
}
