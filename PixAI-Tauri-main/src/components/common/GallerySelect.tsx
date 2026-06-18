import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type GallerySelectOption<T extends string | number> = {
  value: T
  label: string
}

export function GallerySelect<T extends string | number>({
  value,
  options,
  ariaLabel,
  className = '',
  disabled = false,
  onChange
}: {
  value: T
  options: Array<GallerySelectOption<T>>
  ariaLabel: string
  className?: string
  disabled?: boolean
  onChange: (value: T) => void
}) {
  const selectedOption = options.find((option) => option.value === value) || options[0]
  const stringValue = selectedOption ? String(selectedOption.value) : String(value)

  return (
    <Select
      value={stringValue}
      disabled={disabled}
      onValueChange={(nextValue) => {
        const option = options.find((item) => String(item.value) === nextValue)
        if (option) onChange(option.value)
      }}
    >
      <SelectTrigger
        className={cn('gallery-select min-h-9 w-full rounded-lg border-border bg-card text-sm shadow-none', className)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <SelectValue placeholder={ariaLabel} />
      </SelectTrigger>
      <SelectContent align="end" aria-label={ariaLabel}>
        {options.map((option) => (
          <SelectItem key={String(option.value)} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
