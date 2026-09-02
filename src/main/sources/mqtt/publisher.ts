import type { RuntimeSnapshot } from '@shared/types/state'
import type { AppEvent } from '@shared/types/events'
import type { MqttAdapter } from './adapter'

/**
 * Publishes retained status topics (PRD Appendix B) whenever the relevant part of
 * the runtime snapshot changes. Debounced by the caller (services) at 250 ms.
 */
export class StatusPublisher {
  private last = new Map<string, string>()

  constructor(
    private mqtt: () => MqttAdapter | null,
    private enabled: () => boolean,
    private qos: () => 0 | 1 | 2,
    private version: string,
    private profileName: () => string,
    private startedAt: number
  ) {}

  private put(topic: string, payload: unknown, retain = true): void {
    const m = this.mqtt()
    if (!m || !m.isConnected() || !this.enabled()) return
    const text = JSON.stringify(payload)
    const full = `${m.baseTopic()}/${topic}`
    if (retain && this.last.get(full) === text) return
    this.last.set(full, text)
    m.publish(full, text, this.qos(), retain)
  }

  /** Called on (re)connect so retained topics are fresh. */
  reset(): void {
    this.last.clear()
  }

  publishStatus(): void {
    this.put('status', {
      online: true,
      version: this.version,
      profile: this.profileName(),
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000)
    })
  }

  publishSnapshot(
    snap: RuntimeSnapshot,
    outputNames: Record<string, string>,
    outputs: Record<string, { driver: string; universe: number }>
  ): void {
    this.publishStatus()
    for (const [id, h] of Object.entries(snap.outputs)) {
      const name = outputNames[id] ?? id
      this.put(`outputs/${safe(name)}`, {
        state: h.state,
        reason: h.reason ?? null,
        driver: outputs[id]?.driver ?? null,
        universe: outputs[id]?.universe ?? null,
        fps: h.fps,
        lastSend: h.lastSendAt ? new Date(h.lastSendAt).toISOString() : null
      })
    }
    this.put('thorium', {
      connected: snap.thorium.state === 'connected',
      state: snap.thorium.state,
      flight: snap.thorium.flight?.name ?? null,
      simulators: snap.thorium.simulatorsInScope.map((s) => s.name)
    })
    for (const s of snap.thorium.simulatorsInScope) {
      this.put(`thorium/alertLevel/${safe(s.name)}`, { level: s.alertLevel, training: s.training })
    }
    this.put(
      'scenes/active',
      snap.compositor.active.map((a) => ({
        scene: a.sceneName,
        simulator: a.simulatorName,
        layer: a.layerId
      }))
    )
    this.put('blackout', { on: snap.compositor.blackout })
  }

  publishEvent(ev: AppEvent): void {
    this.put(
      'events',
      {
        id: ev.id,
        ts: ev.ts,
        source: ev.source,
        type: ev.type,
        name: ev.name,
        simulator: ev.simulatorName ?? null,
        data: ev.data,
        matched: ev.matchedMappingIds
      },
      false
    )
  }
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '_')
}
