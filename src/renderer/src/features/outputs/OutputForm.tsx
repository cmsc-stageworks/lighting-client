import React, { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Output } from '@shared/types/config'
import type { NetworkInterfaceInfo, SerialDeviceInfo } from '@shared/types/state'
import { invoke } from '../../lib/api'
import { Button, Callout, Field, Input, NumberInput, Select, Switch } from '../../components/ui'

export function OutputForm({
  output,
  onChange
}: {
  output: Output
  onChange: (o: Output) => void
}): React.JSX.Element {
  const [devices, setDevices] = useState<SerialDeviceInfo[]>([])
  const [ifaces, setIfaces] = useState<NetworkInterfaceInfo[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)

  const refreshDevices = async (): Promise<void> => {
    setLoadingDevices(true)
    try {
      setDevices(await invoke('outputs.listSerialDevices'))
    } finally {
      setLoadingDevices(false)
    }
  }
  useEffect(() => {
    void invoke('outputs.listInterfaces').then(setIfaces)
    queueMicrotask(() => void refreshDevices())
  }, [])

  const switchDriver = (driver: 'sacn' | 'enttec-pro'): void => {
    if (driver === output.driver) return
    const base = {
      id: output.id,
      name: output.name,
      enabled: output.enabled,
      universe: output.universe,
      channelRange: output.channelRange
    }
    onChange(
      driver === 'sacn'
        ? {
            ...base,
            driver: 'sacn',
            sacn: {
              mode: 'multicast',
              unicastAddress: null,
              priority: 100,
              sourceName: 'CMSC Lighting Client',
              iface: null,
              fps: 40,
              keepAliveMs: 800
            }
          }
        : {
            ...base,
            driver: 'enttec-pro',
            enttec: {
              portPath: devices[0]?.path ?? '',
              serialNumber: devices[0]?.serialNumber ?? null,
              fps: 40
            }
          }
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name">
          <Input
            value={output.name}
            onChange={(e) => onChange({ ...output, name: e.target.value })}
          />
        </Field>
        <Field label="Driver">
          <Select
            value={output.driver}
            onChange={(v) => switchDriver(v as 'sacn' | 'enttec-pro')}
            options={[
              { value: 'sacn', label: 'sACN / E1.31 (network)' },
              { value: 'enttec-pro', label: 'Enttec USB DMX Pro (serial)' }
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Universe"
          hint={
            output.driver === 'enttec-pro'
              ? 'Label for the wire this Enttec drives; scenes target it by this number.'
              : 'sACN universe number your lighting controller listens on.'
          }
        >
          <NumberInput
            value={output.universe}
            min={1}
            max={63999}
            onChange={(v) => onChange({ ...output, universe: v })}
          />
        </Field>
        <Field
          label="Transmit only channels"
          hint="Guard for shared universes: everything outside this range is sent as 0. Leave off to send all 512."
        >
          <div className="flex items-center gap-2">
            <NumberInput
              value={output.channelRange?.from ?? 1}
              min={1}
              max={512}
              disabled={!output.channelRange}
              onChange={(v) =>
                onChange({
                  ...output,
                  channelRange: { from: v, to: output.channelRange?.to ?? 512 }
                })
              }
              className="!w-24"
            />
            <span className="text-muted">to</span>
            <NumberInput
              value={output.channelRange?.to ?? 512}
              min={1}
              max={512}
              disabled={!output.channelRange}
              onChange={(v) =>
                onChange({
                  ...output,
                  channelRange: { from: output.channelRange?.from ?? 1, to: v }
                })
              }
              className="!w-24"
            />
            <Switch
              checked={!!output.channelRange}
              onChange={(on) =>
                onChange({ ...output, channelRange: on ? { from: 1, to: 512 } : null })
              }
              label={output.channelRange ? 'Limited' : 'All channels'}
            />
          </div>
        </Field>
        <Field label="Enabled" inline={false}>
          <div className="h-10 flex items-center">
            <Switch
              checked={output.enabled}
              onChange={(v) => onChange({ ...output, enabled: v })}
              label={output.enabled ? 'Output is active' : 'Output is off'}
            />
          </div>
        </Field>
      </div>

      {output.driver === 'sacn' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Destination">
              <Select
                value={output.sacn.mode}
                onChange={(v) =>
                  onChange({
                    ...output,
                    sacn: { ...output.sacn, mode: v as 'multicast' | 'unicast' }
                  })
                }
                options={[
                  {
                    value: 'multicast',
                    label: `Multicast (239.255.${(output.universe >> 8) & 255}.${output.universe & 255})`
                  },
                  { value: 'unicast', label: 'Unicast to an IP address' }
                ]}
              />
            </Field>
            {output.sacn.mode === 'unicast' ? (
              <Field label="Unicast address">
                <Input
                  value={output.sacn.unicastAddress ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...output,
                      sacn: { ...output.sacn, unicastAddress: e.target.value || null }
                    })
                  }
                  placeholder="192.168.1.50"
                  className="mono"
                />
              </Field>
            ) : (
              <Field
                label="Send from interface"
                hint="Pick the NIC on the lighting network if the machine has several."
              >
                <Select
                  value={output.sacn.iface ?? ''}
                  onChange={(v) =>
                    onChange({ ...output, sacn: { ...output.sacn, iface: v || null } })
                  }
                  options={[
                    { value: '', label: 'Default (OS chooses)' },
                    ...ifaces
                      .filter((i) => !i.internal)
                      .map((i) => ({ value: i.address, label: `${i.name} — ${i.address}` }))
                  ]}
                />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Field label="Priority" hint="0–200, default 100">
              <NumberInput
                value={output.sacn.priority}
                min={0}
                max={200}
                onChange={(v) => onChange({ ...output, sacn: { ...output.sacn, priority: v } })}
              />
            </Field>
            <Field label="Frame rate" hint="Hz, max 44">
              <NumberInput
                value={output.sacn.fps}
                min={1}
                max={44}
                onChange={(v) => onChange({ ...output, sacn: { ...output.sacn, fps: v } })}
              />
            </Field>
            <Field label="Keep-alive" hint="ms between unchanged re-sends">
              <NumberInput
                value={output.sacn.keepAliveMs}
                min={100}
                max={2000}
                step={100}
                onChange={(v) => onChange({ ...output, sacn: { ...output.sacn, keepAliveMs: v } })}
              />
            </Field>
            <Field label="Source name">
              <Input
                value={output.sacn.sourceName}
                onChange={(e) =>
                  onChange({ ...output, sacn: { ...output.sacn, sourceName: e.target.value } })
                }
                maxLength={63}
              />
            </Field>
          </div>
        </>
      )}

      {output.driver === 'enttec-pro' && (
        <>
          <Field
            label={
              <span className="flex items-center gap-2">
                Serial device
                <button
                  className="text-accent inline-flex items-center gap-1 normal-case tracking-normal font-medium"
                  onClick={() => void refreshDevices()}
                >
                  <RefreshCw size={12} className={loadingDevices ? 'animate-spin' : ''} /> refresh
                </button>
              </span>
            }
            hint="The device is remembered by serial number when available, so it survives a different COM port after replugging."
          >
            <Select
              value={
                output.enttec.serialNumber
                  ? `sn:${output.enttec.serialNumber}`
                  : output.enttec.portPath
                    ? `path:${output.enttec.portPath}`
                    : ''
              }
              onChange={(v) => {
                const d = devices.find(
                  (x) => (x.serialNumber && `sn:${x.serialNumber}` === v) || `path:${x.path}` === v
                )
                onChange({
                  ...output,
                  enttec: {
                    ...output.enttec,
                    portPath: d?.path ?? output.enttec.portPath,
                    serialNumber: d?.serialNumber ?? null
                  }
                })
              }}
              placeholder={devices.length ? 'Choose a device' : 'No serial devices found'}
              options={devices.map((d) => ({
                value: d.serialNumber ? `sn:${d.serialNumber}` : `path:${d.path}`,
                label: d.friendlyName
              }))}
            />
          </Field>
          {!devices.length && (
            <Callout tone="warning">
              No serial devices detected. Plug in the Enttec USB DMX Pro and press refresh. On
              Windows, install the FTDI driver if it does not appear.
            </Callout>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Port path" hint="Filled from the list; edit only if needed">
              <Input
                value={output.enttec.portPath}
                onChange={(e) =>
                  onChange({ ...output, enttec: { ...output.enttec, portPath: e.target.value } })
                }
                className="mono"
                placeholder="COM3 or /dev/tty.usbserial-…"
              />
            </Field>
            <Field label="Frame rate" hint="Hz, max 44">
              <NumberInput
                value={output.enttec.fps}
                min={1}
                max={44}
                onChange={(v) => onChange({ ...output, enttec: { ...output.enttec, fps: v } })}
              />
            </Field>
          </div>
        </>
      )}
      <div className="hidden">
        <Button />
      </div>
    </div>
  )
}
