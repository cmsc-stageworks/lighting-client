import React, { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Lock, Save, Undo2 } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { Toasts } from '../ui/Toasts'
import { Button, Input } from '../ui'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'

/** Session-level PIN gate for /setup routes. */
function PinGate({ onUnlock }: { onUnlock: () => void }): React.JSX.Element {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const submit = async (): Promise<void> => {
    const ok = await invoke('app.verifyPin', pin)
    if (ok) onUnlock()
    else {
      setErr(true)
      setPin('')
    }
  }
  return (
    <div className="h-full flex items-center justify-center">
      <div className="card p-6 w-80 flex flex-col items-center gap-3">
        <Lock className="text-muted" />
        <div className="font-semibold">Setup is locked</div>
        <div className="text-muted text-[13px] text-center">
          Enter the setup PIN to change configuration.
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          invalid={err}
          onChange={(e) => {
            setPin(e.target.value)
            setErr(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="PIN"
          className="text-center tracking-[0.4em]"
        />
        {err && <div className="text-danger text-[12px]">Incorrect PIN</div>}
        <Button variant="primary" className="w-full" onClick={() => void submit()}>
          Unlock
        </Button>
      </div>
    </div>
  )
}

export function AppShell(): React.JSX.Element {
  const loc = useLocation()
  const settings = useConfig((s) => s.config?.settings)
  const dirty = useConfig((s) => s.dirty)
  const saving = useConfig((s) => s.saving)
  const errors = useConfig((s) => s.errors)
  const save = useConfig((s) => s.save)
  const discard = useConfig((s) => s.discard)
  const blackout = useRuntime((s) => s.snapshot?.compositor.blackout ?? false)
  const [unlocked, setUnlocked] = useState(false)
  const locked = !!settings?.setupPinHash && !unlocked
  const inSetup = loc.pathname.startsWith('/setup')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) void save().then((ok) => ok && toast('success', 'Configuration saved'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, save])

  return (
    <div className="h-full flex">
      <Sidebar locked={locked} />
      <div className="grow min-w-0 flex flex-col">
        <StatusBar />
        {blackout && (
          <div className="bg-danger text-white font-semibold text-[13px] px-4 h-9 flex items-center justify-between">
            <span className="blink">● BLACKOUT ACTIVE — all DMX channels are at 0</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void invoke('compositor.setBlackout', false)}
            >
              Release blackout
            </Button>
          </div>
        )}
        {dirty && (
          <div className="bg-warning/15 border-b border-warning/30 text-[13px] px-4 min-h-10 py-1.5 flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-warning">Unsaved changes</span>
            {errors.length > 0 && (
              <div className="text-danger flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold">Could not save — fix these and try again:</span>
                {errors.slice(0, 5).map((e, i) => (
                  <span key={i} className="truncate">
                    • {e}
                  </span>
                ))}
                {errors.length > 5 && <span>…and {errors.length - 5} more</span>}
              </div>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={discard}>
                Discard
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Save size={14} />}
                loading={saving}
                onClick={() =>
                  void save().then((ok) =>
                    ok
                      ? toast('success', 'Configuration saved')
                      : toast('error', 'Configuration not saved — see the errors in the banner')
                  )
                }
              >
                Save
              </Button>
              <span className="kbd">⌘S</span>
            </span>
          </div>
        )}
        <main className="grow min-h-0 overflow-y-auto p-5">
          {inSetup && locked ? <PinGate onUnlock={() => setUnlocked(true)} /> : <Outlet />}
        </main>
      </div>
      <Toasts />
    </div>
  )
}
