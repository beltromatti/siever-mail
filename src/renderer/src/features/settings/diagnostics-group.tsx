import { useEffect, useId, useState } from 'react'
import { FileArchive, FolderOpen, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { DIAGNOSTICS_EXPORT_DAYS, type DiagnosticsInfo } from '@shared/diagnostics'

const PERIOD_LABELS: Record<(typeof DIAGNOSTICS_EXPORT_DAYS)[number], string> = {
  1: 'Ultimo giorno',
  7: 'Ultima settimana',
  21: 'Ultime tre settimane'
}

/** A day kept (AAAA-MM-GG) in words: «3 novembre». */
function sinceWords(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long'
  })
}

function formatSize(bytes: number): string {
  const size = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })
  return bytes < 1024 * 1024
    ? `${size.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${size.format(bytes / 1024 / 1024)} MB`
}

/**
 * Impostazioni › Dati › Diagnostica (vision §14.4): what the app keeps of
 * what happens in it, on this computer only, and the export the user makes
 * to hand over — its period, and whether it carries the Segretario's work
 * in full (only with the AI on: off, nothing of the Segretario shows).
 */
export function DiagnosticsGroup({ aiOn }: { aiOn: boolean }): React.JSX.Element {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null)
  const [days, setDays] = useState<(typeof DIAGNOSTICS_EXPORT_DAYS)[number]>(7)
  const [withSegretario, setWithSegretario] = useState(true)
  const [exporting, setExporting] = useState(false)
  const segretarioId = useId()

  useEffect(() => {
    let current = true
    void window.diagnosticsApi
      .info()
      .then((next) => current && setInfo(next))
      .catch(() => undefined)

    return () => {
      current = false
    }
  }, [exporting])

  const exportDiagnostics = async (): Promise<void> => {
    setExporting(true)

    try {
      const exported = await window.diagnosticsApi.export({
        days,
        segretario: aiOn && withSegretario
      })

      if (exported) {
        toast.success('Diagnostica esportata', {
          description: `${exported.path.split(/[\\/]/).pop()} · ${formatSize(exported.bytes)}: è nella cartella che si è aperta, pronta da allegare.`
        })
      }
    } catch (error) {
      toast.error('Diagnostica non esportata', {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setExporting(false)
    }
  }

  const openFolder = (): void => {
    void window.diagnosticsApi.openFolder().catch((error: unknown) =>
      toast.error('La cartella non si è aperta', {
        description: error instanceof Error ? error.message : undefined
      })
    )
  }

  return (
    <div className="settings-group space-y-3">
      <div>
        <p className="eyebrow">Diagnostica</p>
        <p className="text-muted-foreground mt-1 text-[11px]">
          SIEVER Mail tiene su questo computer un registro di ciò che succede: gli errori, come
          stanno le connessioni, ciò che si fa nell’app
          {aiOn ? ' e il lavoro del Segretario' : ''}. Non lo manda a nessuno: per una segnalazione
          lo esporti e lo alleghi tu.
        </p>
        {info?.since && (
          <p className="text-muted-foreground mt-1 text-[11px]">
            Dal {sinceWords(info.since)} · {formatSize(info.bytes)} · tenuto {info.keptDays} giorni
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(days)}
          onValueChange={(value) =>
            setDays(Number(value) as (typeof DIAGNOSTICS_EXPORT_DAYS)[number])
          }
          disabled={exporting}
        >
          <SelectTrigger className="w-[190px]" aria-label="Periodo da esportare">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIAGNOSTICS_EXPORT_DAYS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {PERIOD_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={exporting}
          onClick={() => void exportDiagnostics()}
        >
          {exporting ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <FileArchive className="size-3.5" />
          )}
          Esporta…
        </Button>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={openFolder}>
          <FolderOpen className="size-3.5" />
          Apri la cartella
        </Button>
      </div>

      {aiOn && (
        <label htmlFor={segretarioId} className="flex cursor-pointer items-start gap-2">
          <Checkbox
            id={segretarioId}
            className="mt-0.5"
            checked={withSegretario}
            disabled={exporting}
            onCheckedChange={(checked) => setWithSegretario(checked === true)}
          />
          <span className="text-[12px]">
            Con il lavoro del Segretario
            <span className="text-muted-foreground block text-[11px]">
              Le sue sessioni per intero e la sua memoria: servono a capire ciò che ha fatto, e
              contengono il testo delle mail, degli eventi e dei file che ha letto.
            </span>
          </span>
        </label>
      )}
    </div>
  )
}
