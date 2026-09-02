import React, { useEffect, useState } from 'react'
import { Check, FlaskConical, KeyRound, Plus, Send, X } from 'lucide-react'
import type { MqttTestReport } from '@shared/types/state'
import { uuid } from '@shared/utils'
import { useConfig } from '../../store/config'
import { useRuntime } from '../../store/runtime'
import { useEvents } from '../../store/events'
import { invoke } from '../../lib/api'
import { toast } from '../../store/toasts'
import { connLabel, connTone, fmtTime } from '../../lib/format'
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  Input,
  InlineConfirm,
  KeyValue,
  NumberInput,
  PageHeader,
  Pill,
  SectionTitle,
  Select,
  Switch,
  TextArea
} from '../../components/ui'

export function MqttPage(): React.JSX.Element {
  const profile = useConfig((s) => s.draft)
  const update = useConfig((s) => s.update)
  const dirty = useConfig((s) => s.dirty)
  const settings = useConfig((s) => s.config?.settings)
  const snapshot = useRuntime((s) => s.snapshot)
  const messages = useEvents((s) => s.mqttMessages)
  const [test, setTest] = useState<MqttTestReport | 'running' | null>(null)
  const [pw, setPw] = useState('')
  const [secretsOk, setSecretsOk] = useState(true)
  const [hasPw, setHasPw] = useState(false)
  const [pubTopic, setPubTopic] = useState('')
  const [pubPayload, setPubPayload] = useState('{"hello":"world"}')
  const [pubRetain, setPubRetain] = useState(false)

  useEffect(() => {
    void invoke('secrets.available').then(setSecretsOk)
  }, [])
  useEffect(() => {
    const id = profile?.mqtt.passwordSecretId
    void Promise.resolve(id ? invoke('secrets.has', id) : false).then(setHasPw)
  }, [profile?.mqtt.passwordSecretId])

  if (!profile || !snapshot) return <></>
  const m = profile.mqtt
  const rt = snapshot.mqtt
  const set = (p: Partial<typeof m>): void => update((d) => ({ ...d, mqtt: { ...d.mqtt, ...p } }))
  const base = m.publish.baseTopic.replace('{instanceName}', settings?.instanceName ?? 'lighting')

  const savePassword = async (): Promise<void> => {
    try {
      const id = await invoke('secrets.set', m.passwordSecretId, pw)
      set({ passwordSecretId: id })
      setPw('')
      setHasPw(true)
      toast('success', 'Password stored securely — save the profile to apply it')
    } catch (err) {
      toast('error', (err as Error).message)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="MQTT"
        subtitle="Subscribe to topics as an event source and publish this app's status."
        actions={
          <>
            <Pill tone={m.enabled ? connTone(rt.state) : 'muted'}>
              {m.enabled ? connLabel(rt.state) : 'Disabled'}
            </Pill>
            <Button
              icon={<FlaskConical size={16} />}
              loading={test === 'running'}
              onClick={() => {
                setTest('running')
                void invoke('mqtt.test').then(setTest)
              }}
              disabled={dirty}
            >
              Test connection
            </Button>
          </>
        }
      />
      {dirty && (
        <Callout tone="warning" className="mb-4">
          Broker changes apply after you save.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <SectionTitle
            action={
              <Switch
                checked={m.enabled}
                onChange={(v) => set({ enabled: v })}
                label={m.enabled ? 'On' : 'Off'}
              />
            }
          >
            Broker
          </SectionTitle>
          <Field label="URL" hint="mqtt://, mqtts://, ws:// or wss://">
            <Input
              value={m.url}
              onChange={(e) => set({ url: e.target.value })}
              className="mono"
              placeholder="mqtt://broker.local:1883"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Username">
              <Input
                value={m.username ?? ''}
                onChange={(e) => set({ username: e.target.value || null })}
              />
            </Field>
            <Field
              label="Password"
              hint={
                hasPw
                  ? 'A password is stored (encrypted). Enter a new one to replace it.'
                  : 'Stored encrypted with the OS keychain.'
              }
            >
              <div className="flex gap-1.5">
                <Input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder={hasPw ? '••••••••' : 'none'}
                  disabled={!secretsOk}
                />
                <Button
                  icon={<KeyRound size={14} />}
                  onClick={() => void savePassword()}
                  disabled={!pw || !secretsOk}
                />
              </div>
            </Field>
          </div>
          {!secretsOk && (
            <Callout tone="warning" className="mt-2">
              Encrypted storage is unavailable on this system; passwords cannot be saved.
            </Callout>
          )}
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Field label="Client id">
              <Input
                value={m.clientId}
                onChange={(e) => set({ clientId: e.target.value })}
                className="mono"
              />
            </Field>
            <Field label="Keep-alive (s)">
              <NumberInput
                value={m.keepalive}
                min={5}
                max={3600}
                onChange={(v) => set({ keepalive: v })}
              />
            </Field>
            <div className="flex flex-col gap-2 justify-end pb-1">
              <Checkbox
                checked={m.cleanSession}
                onChange={(v) => set({ cleanSession: v })}
                label="Clean session"
              />
              <Checkbox
                checked={m.rejectUnauthorized}
                onChange={(v) => set({ rejectUnauthorized: v })}
                label="Verify TLS certs"
              />
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle
            action={
              <Switch
                checked={m.publish.enabled}
                onChange={(v) => set({ publish: { ...m.publish, enabled: v } })}
                label={m.publish.enabled ? 'On' : 'Off'}
              />
            }
          >
            Status publishing
          </SectionTitle>
          <Field label="Base topic" hint={`Resolves to ${base}`}>
            <Input
              value={m.publish.baseTopic}
              onChange={(e) => set({ publish: { ...m.publish, baseTopic: e.target.value } })}
              className="mono"
            />
          </Field>
          <div className="flex flex-col gap-2 mt-3">
            <Checkbox
              checked={m.publish.commandTopic}
              onChange={(v) => set({ publish: { ...m.publish, commandTopic: v } })}
              label={
                <span>
                  Accept commands on <span className="mono">{base}/cmd</span>
                </span>
              }
            />
            <Checkbox
              checked={m.publish.publishEvents}
              onChange={(v) => set({ publish: { ...m.publish, publishEvents: v } })}
              label={
                <span>
                  Publish every event to <span className="mono">{base}/events</span> (chatty)
                </span>
              }
            />
            <div className="flex items-center gap-2">
              <span className="text-[13px]">QoS</span>
              <Select
                value={String(m.publish.qos)}
                onChange={(v) => set({ publish: { ...m.publish, qos: Number(v) as 0 | 1 | 2 } })}
                options={[
                  { value: '0', label: '0' },
                  { value: '1', label: '1' },
                  { value: '2', label: '2' }
                ]}
                className="w-20"
              />
            </div>
          </div>
          <div className="text-[12px] text-muted mt-3">
            Retained topics: <span className="mono">status</span>,{' '}
            <span className="mono">outputs/&lt;name&gt;</span>,{' '}
            <span className="mono">thorium</span>,{' '}
            <span className="mono">thorium/alertLevel/&lt;sim&gt;</span>,{' '}
            <span className="mono">scenes/active</span>, <span className="mono">blackout</span>.
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <SectionTitle
          action={
            <Button
              size="sm"
              icon={<Plus size={13} />}
              onClick={() =>
                set({
                  subscriptions: [
                    ...m.subscriptions,
                    { id: uuid(), topic: '', qos: 0, enabled: true }
                  ]
                })
              }
            >
              Add subscription
            </Button>
          }
        >
          Subscriptions
        </SectionTitle>
        {m.subscriptions.length === 0 ? (
          <div className="text-muted text-[13px]">
            No subscriptions. Add a topic filter (wildcards + and # allowed) to turn incoming
            messages into events.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {m.subscriptions.map((s) => {
              const count = rt.subscriptions.find((x) => x.topic === s.topic)?.count ?? 0
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <Switch
                    checked={s.enabled}
                    onChange={(v) =>
                      set({
                        subscriptions: m.subscriptions.map((x) =>
                          x.id === s.id ? { ...x, enabled: v } : x
                        )
                      })
                    }
                  />
                  <Input
                    value={s.topic}
                    onChange={(e) =>
                      set({
                        subscriptions: m.subscriptions.map((x) =>
                          x.id === s.id ? { ...x, topic: e.target.value } : x
                        )
                      })
                    }
                    placeholder="cmsc/lobby/#"
                    className="mono grow"
                  />
                  <Select
                    value={String(s.qos)}
                    onChange={(v) =>
                      set({
                        subscriptions: m.subscriptions.map((x) =>
                          x.id === s.id ? { ...x, qos: Number(v) as 0 | 1 | 2 } : x
                        )
                      })
                    }
                    options={[
                      { value: '0', label: 'QoS 0' },
                      { value: '1', label: 'QoS 1' },
                      { value: '2', label: 'QoS 2' }
                    ]}
                    className="w-28"
                  />
                  <Badge>{count} msgs</Badge>
                  <InlineConfirm
                    onConfirm={() =>
                      set({ subscriptions: m.subscriptions.filter((x) => x.id !== s.id) })
                    }
                    label="Remove"
                  />
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <SectionTitle>Publish a test message</SectionTitle>
          <Field label="Topic">
            <Input
              value={pubTopic}
              onChange={(e) => setPubTopic(e.target.value)}
              placeholder={`${base}/cmd`}
              className="mono"
            />
          </Field>
          <Field label="Payload" className="mt-3">
            <TextArea
              value={pubPayload}
              onChange={(e) => setPubPayload(e.target.value)}
              rows={3}
              className="mono"
            />
          </Field>
          <div className="flex items-center gap-3 mt-3">
            <Checkbox checked={pubRetain} onChange={setPubRetain} label="Retain" />
            <Button
              variant="primary"
              icon={<Send size={14} />}
              className="ml-auto"
              disabled={rt.state !== 'connected'}
              onClick={() =>
                void invoke(
                  'mqtt.publish',
                  pubTopic || `${base}/cmd`,
                  pubPayload,
                  0,
                  pubRetain
                ).then(() => toast('success', 'Published'))
              }
            >
              Publish
            </Button>
          </div>
          <div className="text-[12px] text-muted mt-3">
            Try the command topic:{' '}
            <span className="mono">{`{"action":"activateScene","scene":"Flash"}`}</span> or{' '}
            <span className="mono">{`{"action":"blackout","on":true}`}</span>
          </div>
          {test && test !== 'running' && (
            <div className="mt-3 rounded-lg bg-surface-2 p-3">
              <Badge tone={test.ok ? 'success' : 'danger'}>{test.ok ? 'PASS' : 'FAIL'}</Badge>
              {test.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-[13px] mt-1">
                  {s.ok ? (
                    <Check size={15} className="text-success mt-0.5 shrink-0" />
                  ) : (
                    <X size={15} className="text-danger mt-0.5 shrink-0" />
                  )}
                  <span>
                    <span className="font-medium">{s.name}</span>
                    {s.detail && <span className="text-muted"> — {s.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle>Received messages</SectionTitle>
          <KeyValue
            items={[
              {
                k: 'State',
                v: rt.reason ? `${connLabel(rt.state)} — ${rt.reason}` : connLabel(rt.state)
              },
              { k: 'Rate', v: `${rt.messagesPerSec}/s` },
              { k: 'Reconnects', v: rt.reconnects }
            ]}
          />
          <div className="mt-3 card bg-surface-2 max-h-72 overflow-y-auto mono text-[12px]">
            {messages.length === 0 ? (
              <div className="p-4 text-center text-muted font-sans">Nothing received yet.</div>
            ) : (
              [...messages]
                .reverse()
                .slice(0, 100)
                .map((x, i) => (
                  <div key={i} className="px-2.5 py-1.5 border-b border-border/60 flex gap-2">
                    <span className="text-faint shrink-0">{fmtTime(x.ts)}</span>
                    <span className="text-accent shrink-0">{x.topic}</span>
                    <span className="text-muted truncate">{x.payload}</span>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
