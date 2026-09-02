import { SerialPort } from 'serialport'
import os from 'os'
import type { NetworkInterfaceInfo, SerialDeviceInfo } from '@shared/types/state'

export async function listSerialDevices(): Promise<SerialDeviceInfo[]> {
  const ports = await SerialPort.list()
  return ports.map((p) => {
    const vendor = (p.vendorId ?? '').toLowerCase()
    const isFtdi = vendor === '0403'
    const label =
      p.manufacturer && p.manufacturer.trim().length > 0
        ? p.manufacturer
        : isFtdi
          ? 'Enttec / FTDI'
          : 'Serial device'
    return {
      path: p.path,
      manufacturer: p.manufacturer ?? null,
      serialNumber: p.serialNumber ?? null,
      vendorId: p.vendorId ?? null,
      productId: p.productId ?? null,
      friendlyName: `${label} (${p.path})${p.serialNumber ? ' · SN ' + p.serialNumber : ''}`
    }
  })
}

export async function findPortBySerial(serial: string): Promise<string | null> {
  const ports = await SerialPort.list()
  return ports.find((p) => p.serialNumber === serial)?.path ?? null
}

export function listNetworkInterfaces(): NetworkInterfaceInfo[] {
  const out: NetworkInterfaceInfo[] = []
  const ifs = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4') continue
      out.push({ name, address: a.address, family: a.family, internal: a.internal })
    }
  }
  return out.sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name))
}
