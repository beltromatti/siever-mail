import { useEffect, useState, useSyncExternalStore } from 'react'
import { LoaderCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { refusalWords, type ConnectionRefusedNotice } from '@shared/models'

/**
 * The refusals waiting for an answer, kept outside the screens: the window
 * goes from the launch to the setup to the workspace, and what was said in
 * one is still to answer in the next. One per connection, the newest words.
 */
let queue: ReadonlyArray<ConnectionRefusedNotice> = []
const listeners = new Set<() => void>()
let listening = false

function sameConnection(a: ConnectionRefusedNotice, b: ConnectionRefusedNotice): boolean {
  return a.family === b.family && a.id === b.id
}

function setQueue(next: ReadonlyArray<ConnectionRefusedNotice>): void {
  queue = next
  listeners.forEach((listener) => listener())
}

function add(notice: ConnectionRefusedNotice): void {
  setQueue(
    queue.some((entry) => sameConnection(entry, notice))
      ? queue.map((entry) => (sameConnection(entry, notice) ? notice : entry))
      : [...queue, notice]
  )
}

function settle(notice: ConnectionRefusedNotice): void {
  setQueue(queue.filter((entry) => !sameConnection(entry, notice)))
}

/**
 * Listens once for the window's whole life: the refusals said from now on,
 * and those already standing — at launch the first come before the page.
 */
function subscribe(listener: () => void): () => void {
  if (!listening) {
    listening = true
    window.mailApi.onConnectionRefused(add)
    void window.mailApi
      .listConnectionRefusals()
      .then((standing) => standing.forEach(add))
      .catch((error: unknown) => console.error('[connections] Refusals not listed', error))
  }

  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Asks the refusal's window again, for a connection the user wants to put right now. */
export function showConnectionRefused(notice: ConnectionRefusedNotice): void {
  add(notice)
}

/**
 * A connection turned down for good — a mailbox, a calendar — said once,
 * when it happens (§13ter), on whatever screen the window is: what the
 * server said, and the user's remedies. "Ricollega" signs in again on the
 * same connection — the password asked here, or the provider's sign-in —
 * or, for a certificate or a source gone, tries again; "Togli" takes the
 * connection away, asked first; "Più tardi" leaves it stopped, to put right
 * from Settings › Connessioni. One put right meanwhile, or taken away, is
 * not asked about (`isRefused`).
 */
export function ConnectionRefusedDialog({
  isRefused,
  onReconnect,
  onRemove,
  onOpenChange
}: {
  /** Whether the connection is still turned down; undefined while it is not known yet. */
  isRefused: (notice: ConnectionRefusedNotice) => boolean | undefined
  /** Signs the connection in again; `password` for one that signs in with one. */
  onReconnect: (notice: ConnectionRefusedNotice, password?: string) => Promise<void>
  /** Takes the connection away; the user has confirmed it here. */
  onRemove: (notice: ConnectionRefusedNotice) => void
  /** A refusal on screen, or gone: the shell's shortcuts keep quiet behind it. */
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const waiting = useSyncExternalStore(subscribe, () => queue)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const notice = waiting.find((entry) => isRefused(entry) === true) ?? null
  const key = notice ? `${notice.family}:${notice.id}` : null

  // Another connection on screen starts clean.
  useEffect(() => {
    setPassword('')
    setProblem(null)
    setRemoving(false)
  }, [key])

  // Put right or taken away meanwhile: nothing left to ask.
  useEffect(() => {
    if (!working) {
      waiting.filter((entry) => isRefused(entry) === false).forEach(settle)
    }
  }, [isRefused, waiting, working])

  useEffect(() => {
    onOpenChange(notice !== null)
  }, [notice, onOpenChange])

  if (!notice) {
    return null
  }

  const { title, body } = refusalWords(notice)
  const asksPassword = notice.refusal === 'accesso' && notice.signIn === 'password'
  const signsInAgain =
    notice.refusal !== 'certificato' &&
    notice.refusal !== 'sparito' &&
    notice.signIn !== 'password' &&
    notice.signIn !== 'none'
  const calendar = notice.family === 'calendario'
  const reconnect = async (): Promise<void> => {
    setWorking(true)
    setProblem(null)

    try {
      await onReconnect(notice, asksPassword ? password : undefined)
      settle(notice)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Non si è ricollegata.')
    } finally {
      setWorking(false)
    }
  }
  // A sign-in left open in the browser is let go: the connection stays stopped.
  const later = (): void => {
    if (working) {
      void window.mailApi.cancelSignIn()
    }

    settle(notice)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !working && later()}>
      <DialogContent
        hideClose
        role="alertdialog"
        overlayClassName="z-[60]"
        className="z-[70] w-[min(460px,calc(100vw-2rem))] gap-4"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {removing
              ? `Togliere ${calendar ? 'il calendario' : 'la casella'} ${notice.label}?`
              : title}
          </DialogTitle>
          <DialogDescription>
            {removing
              ? calendar
                ? 'I suoi eventi spariscono da SIEVER Mail; nel calendario restano come sono. Puoi ricollegarlo quando vuoi.'
                : 'SIEVER Mail toglie dal computer la sua posta, la sua firma e quello che il Segretario aveva annotato su questa casella. Sul server non cambia nulla: puoi ricollegarla quando vuoi.'
              : body}
          </DialogDescription>
        </DialogHeader>
        {!removing && notice.detail && (
          <p className="text-muted-foreground bg-hover rounded-md px-2.5 py-2 text-[12px] break-words">
            Il server ha detto: {notice.detail}
          </p>
        )}
        {!removing && asksPassword && (
          <form
            onSubmit={(event) => {
              event.preventDefault()

              if (password && !working) {
                void reconnect()
              }
            }}
          >
            <Input
              autoFocus
              type="password"
              value={password}
              disabled={working}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`La password di ${notice.label}`}
              autoComplete="current-password"
            />
          </form>
        )}
        {problem && <p className="text-destructive-soft-foreground text-[12.5px]">{problem}</p>}
        <DialogFooter className="flex-wrap">
          {removing ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
                Annulla
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  settle(notice)
                  onRemove(notice)
                }}
              >
                Togli
              </Button>
            </>
          ) : (
            <>
              {/* Waiting on the provider's sign-in, the user may let it go. */}
              <Button
                type="button"
                variant="ghost"
                disabled={working && !signsInAgain}
                onClick={later}
              >
                Più tardi
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={working}
                onClick={() => setRemoving(true)}
              >
                Togli
              </Button>
              <Button
                type="button"
                disabled={working || (asksPassword && !password)}
                onClick={() => void reconnect()}
              >
                {working && <LoaderCircle className="size-4 animate-spin" />}
                {signsInAgain || asksPassword ? 'Ricollega' : 'Riprova'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
