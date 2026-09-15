import React, { useEffect, useState } from 'react'
import {
  ClipboardCopy,
  Download,
  DownloadCloud,
  ExternalLink,
  FolderOpen,
  History,
  Plus,
  RefreshCw,
  RotateCw,
  Upload
} from 'lucide-react'
import type { ImportPreview } from '@shared/types/state'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import { formatAgo, updateLabel } from '../../lib/format'
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  InlineConfirm,
  KeyValue,
  Modal,
  NumberInput,
  PageHeader,
  SectionTitle,
  Select,
  Switch
} from '../../components/ui'

export function SettingsPage(): React.JSX.Element {
  const config = useConfig((s) => s.config)
  const patchSettings = useConfig((s) => s.patchSettings)
  const dirty = useConfig((s) => s.dirty)
  const update = useRuntime((s) => s.snapshot?.update)
  const activeScenes = useRuntime((s) => s.snapshot?.compositor.active.length ?? 0)
  const [versions, setVersions] = useState<Record<string, string> | null>(null)
  const [backups, setBackups] = useState<{ path: string; ts: number; size: number }[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [newProfile, setNewProfile] = useState<{
    name: string
    kind: 'central' | 'single-ship'
  } | null>(null)
  const [pin, setPin] = useState('')

  useEffect(() => {
    void invoke('app.getVersions').then((v) => setVersions(v as unknown as Record<string, string>))
    void invoke('config.listBackups').then(setBackups)
  }, [config])

  if (!config) return <></>
  const s = config.settings

  const doImport = async (): Promise<void> => {
    try {
      const p = await invoke('config.importPreview')
      if (p) setPreview(p)
    } catch (err) {
      toast('error', `Import failed: ${(err as Error).message}`)
    }
  }
  const applyImport = async (): Promise<void> => {
    if (!preview) return
    const r = await invoke('config.importApply', preview.token)
    setPreview(null)
    if (r.ok) toast('success', 'Import applied')
    else toast('error', `Import finished with problems: ${(r.errors ?? []).join('; ')}`)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Settings" subtitle="App-wide behavior. These save immediately." />
      {dirty && (
        <Callout tone="warning" className="mb-4">
          You have unsaved profile changes on another page.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <SectionTitle>Profiles</SectionTitle>
          <div className="text-[13px] text-muted mb-3">
            A profile holds all connections, outputs, scenes and mappings. Switch profiles to run
            the same build on the central machine or a single-ship computer.
          </div>
          <div className="flex flex-col gap-2">
            {config.profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-3 card px-3 py-2">
                <div className="grow">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[12px] text-muted">
                    {p.kind === 'central' ? 'Central (many simulators)' : 'Single ship'} ·{' '}
                    {p.outputs.length} outputs · {p.scenes.length} scenes · {p.mappings.length}{' '}
                    mappings
                  </div>
                </div>
                {p.id === config.activeProfileId ? (
                  <span className="text-success text-[12px] font-semibold">Active</span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        void invoke('config.setActiveProfile', p.id).then(() =>
                          toast('success', `Switched to "${p.name}"`)
                        )
                      }
                    >
                      Activate
                    </Button>
                    <InlineConfirm onConfirm={() => void invoke('config.deleteProfile', p.id)} />
                  </>
                )}
              </div>
            ))}
          </div>
          <Button
            size="sm"
            icon={<Plus size={13} />}
            className="mt-3"
            onClick={() => setNewProfile({ name: '', kind: 'single-ship' })}
          >
            New profile
          </Button>
        </Card>

        <Card>
          <SectionTitle>Startup & window</SectionTitle>
          <div className="flex flex-col gap-3">
            <Field label="Instance name" hint="Used in the MQTT base topic and diagnostics">
              <Input
                key={s.instanceName}
                defaultValue={s.instanceName}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== s.instanceName) void patchSettings({ instanceName: v })
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </Field>
            <Switch
              checked={s.launchAtLogin}
              onChange={(v) => void invoke('app.setLaunchAtLogin', v)}
              label="Launch at login"
            />
            <Switch
              checked={s.startMinimized}
              onChange={(v) => void patchSettings({ startMinimized: v })}
              label="Start minimized to the tray"
            />
            <Switch
              checked={s.closeToTray}
              onChange={(v) => void patchSettings({ closeToTray: v })}
              label="Closing the window keeps the app running in the tray"
            />
            <Switch
              checked={s.sendZeroFrameOnExit}
              onChange={(v) => void patchSettings({ sendZeroFrameOnExit: v })}
              label="Send an all-zero DMX frame when quitting"
            />
            <Field label="Theme">
              <Select
                value={s.theme}
                onChange={(v) => void patchSettings({ theme: v as 'dark' | 'light' | 'system' })}
                options={[
                  { value: 'dark', label: 'Dark (control room)' },
                  { value: 'light', label: 'Light' },
                  { value: 'system', label: 'Follow system' }
                ]}
                className="w-56"
              />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionTitle>Setup lock</SectionTitle>
          <div className="text-[13px] text-muted mb-3">
            {s.setupPinHash
              ? 'A PIN protects the Setup pages. Enter a new PIN to change it, or clear it.'
              : 'Optionally require a PIN to open the Setup pages so staff only see the Dashboard.'}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4–8 digits"
              className="!w-40"
            />
            <Button
              variant="primary"
              disabled={!/^\d{4,8}$/.test(pin)}
              onClick={() =>
                void invoke('app.setPin', pin).then(() => {
                  setPin('')
                  toast('success', 'PIN set')
                })
              }
            >
              Set PIN
            </Button>
            {s.setupPinHash && (
              <Button
                variant="ghost"
                onClick={() =>
                  void invoke('app.setPin', null).then(() => toast('info', 'PIN removed'))
                }
              >
                Remove PIN
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle>Logging & diagnostics</SectionTitle>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Log level">
                <Select
                  value={s.logLevel}
                  onChange={(v) =>
                    void patchSettings({ logLevel: v as 'debug' | 'info' | 'warn' | 'error' })
                  }
                  options={['debug', 'info', 'warn', 'error'].map((l) => ({ value: l, label: l }))}
                />
              </Field>
              <Field label="Event log size" hint="events kept in memory">
                <NumberInput
                  value={s.eventLogSize}
                  min={100}
                  max={20000}
                  step={100}
                  onChange={(v) => void patchSettings({ eventLogSize: v })}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button icon={<FolderOpen size={14} />} onClick={() => void invoke('app.openLogs')}>
                Open logs folder
              </Button>
              <Button
                icon={<ClipboardCopy size={14} />}
                onClick={() =>
                  void invoke('app.copyDiagnostics').then(() =>
                    toast('success', 'Diagnostics copied to clipboard')
                  )
                }
              >
                Copy diagnostics
              </Button>
            </div>
            {versions && (
              <KeyValue
                items={[
                  { k: 'App', v: versions.app },
                  { k: 'Electron', v: versions.electron },
                  { k: 'Node', v: versions.node },
                  { k: 'Platform', v: versions.platform }
                ]}
              />
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle>Updates</SectionTitle>
          <div className="flex flex-col gap-3">
            {update?.state === 'disabled' ? (
              <div className="text-[13px] text-muted">
                Auto-update is only active in an installed build.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{updateLabel(update?.state ?? 'idle')}</span>
                  {update?.state === 'downloading' && (
                    <span className="text-[12px] text-muted mono">{update.percent}%</span>
                  )}
                </div>
                {update?.state === 'downloading' && (
                  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${update.percent}%` }}
                    />
                  </div>
                )}
                {update?.state === 'error' && update.error && (
                  <Callout tone="danger">{update.error}</Callout>
                )}
                {update?.releaseNotes &&
                  (update.state === 'available' || update.state === 'ready') && (
                    <div className="text-[12px] text-muted whitespace-pre-wrap max-h-32 overflow-y-auto card p-2">
                      {update.releaseNotes}
                    </div>
                  )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    icon={<RefreshCw size={14} />}
                    disabled={
                      update?.state === 'checking' ||
                      update?.state === 'downloading' ||
                      update?.state === 'ready'
                    }
                    onClick={() => void invoke('update.check')}
                  >
                    {update?.state === 'checking' ? 'Checking…' : 'Check for updates'}
                  </Button>
                  {update?.state === 'available' && (
                    <Button
                      variant="primary"
                      icon={<DownloadCloud size={14} />}
                      onClick={() => void invoke('update.download')}
                    >
                      Download update
                    </Button>
                  )}
                  {update?.state === 'ready' && (
                    <InlineConfirm
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <RotateCw size={14} /> Restart & install
                        </span>
                      }
                      question={
                        activeScenes > 0
                          ? `${activeScenes} scene${activeScenes === 1 ? ' is' : 's are'} live — release outputs and install now?`
                          : 'Restart and install now?'
                      }
                      variant="primary"
                      onConfirm={() => void invoke('update.install')}
                    />
                  )}
                  <Button
                    variant="ghost"
                    icon={<ExternalLink size={14} />}
                    onClick={() => void invoke('update.openReleasePage')}
                  >
                    Release notes
                  </Button>
                </div>
                <Switch
                  checked={s.autoCheckUpdates}
                  onChange={(v) => void patchSettings({ autoCheckUpdates: v })}
                  label="Automatically check for updates"
                />
              </>
            )}
          </div>
        </Card>

        <Card className="col-span-2">
          <SectionTitle>Import, export & backups</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              icon={<Download size={14} />}
              onClick={() =>
                void invoke('config.export', 'all').then(
                  (r) => r && toast('success', `Exported to ${r.path}`)
                )
              }
            >
              Export full config
            </Button>
            <Button
              icon={<Download size={14} />}
              onClick={() =>
                void invoke('config.export', 'partial').then(
                  (r) => r && toast('success', `Exported to ${r.path}`)
                )
              }
            >
              Export scenes, mappings, simulators & layers
            </Button>
            <Button icon={<Upload size={14} />} onClick={() => void doImport()}>
              Import…
            </Button>
          </div>
          <div className="text-[13px] text-muted mt-2">
            Partial exports merge by name on import, so you can build scenes on the central machine
            and ship them to a single-ship profile.
          </div>
          <div className="mt-4">
            <div className="field-label flex items-center gap-1.5">
              <History size={12} /> Automatic backups
            </div>
            {backups.length === 0 ? (
              <div className="text-[13px] text-faint">
                No backups yet (one is written before each save).
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {backups.slice(0, 20).map((b) => {
                  const preUpgrade = /preupgrade-v(\d+)/.exec(b.path.replace(/\\/g, '/'))
                  return (
                    <div key={b.path} className="flex items-center gap-3 text-[13px]">
                      <span className="mono text-muted">{new Date(b.ts).toLocaleString()}</span>
                      <span className="text-faint">
                        {formatAgo(b.ts)} · {Math.round(b.size / 1024)} KB
                      </span>
                      {preUpgrade && (
                        <span
                          className="rounded bg-warning/15 text-warning px-1.5 py-0.5 text-[11px]"
                          title="Saved automatically before a config schema upgrade — restore this if you downgrade the app"
                        >
                          pre-upgrade (v{preUpgrade[1]})
                        </span>
                      )}
                      <InlineConfirm
                        label="Restore"
                        question="Replace current config?"
                        variant="secondary"
                        onConfirm={() =>
                          void invoke('config.restoreBackup', b.path).then((r) =>
                            r.ok
                              ? toast('success', 'Backup restored')
                              : toast('error', (r.errors ?? []).join('; '))
                          )
                        }
                        className="ml-auto"
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Import preview"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant={preview?.kind === 'all' ? 'danger' : 'primary'}
              onClick={() => void applyImport()}
            >
              {preview?.kind === 'all' ? 'Replace everything' : 'Merge'}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-3">
            {preview.warnings.map((w, i) => (
              <Callout key={i} tone="warning">
                {w}
              </Callout>
            ))}
            <KeyValue
              items={[
                ...Object.entries(preview.summary.added).map(([k, v]) => ({ k: `New ${k}`, v })),
                ...Object.entries(preview.summary.updated).map(([k, v]) => ({
                  k: `Updated ${k}`,
                  v
                }))
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={!!newProfile}
        onClose={() => setNewProfile(null)}
        title="New profile"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewProfile(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!newProfile?.name.trim()}
              onClick={() =>
                newProfile &&
                void invoke('config.createProfile', newProfile.name.trim(), newProfile.kind).then(
                  () => {
                    setNewProfile(null)
                    toast('success', 'Profile created')
                  }
                )
              }
            >
              Create
            </Button>
          </>
        }
      >
        {newProfile && (
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <Input
                value={newProfile.name}
                onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                placeholder="Bridge 1 station"
                autoFocus
              />
            </Field>
            <Field label="Kind">
              <Select
                value={newProfile.kind}
                onChange={(v) =>
                  setNewProfile({ ...newProfile, kind: v as 'central' | 'single-ship' })
                }
                options={[
                  { value: 'central', label: 'Central — follows many simulators' },
                  { value: 'single-ship', label: 'Single ship — one simulator' }
                ]}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
