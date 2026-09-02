import { safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { uuid } from '@shared/utils'
import { getLogger } from '../logging'

const log = getLogger('secrets')

/**
 * Encrypted-at-rest key/value vault backed by Electron safeStorage (OS keychain /
 * DPAPI). Values are stored base64 in secrets.json; ids are referenced from config.
 */
export class SecretVault {
  private file: string
  private data: Record<string, string> = {}

  constructor(userData: string) {
    this.file = join(userData, 'secrets.json')
  }

  async load(): Promise<void> {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  has(id: string): boolean {
    return id in this.data
  }

  get(id: string | null | undefined): string | null {
    if (!id || !(id in this.data)) return null
    if (!this.available()) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.data[id], 'base64'))
    } catch (err) {
      log.warn(`failed to decrypt secret ${id}`, err)
      return null
    }
  }

  async set(id: string | null, value: string): Promise<string> {
    if (!this.available()) throw new Error('Encrypted storage is not available on this system')
    const key = id ?? uuid()
    this.data[key] = safeStorage.encryptString(value).toString('base64')
    await this.persist()
    return key
  }

  async delete(id: string): Promise<void> {
    delete this.data[id]
    await this.persist()
  }

  private async persist(): Promise<void> {
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmp, this.file)
  }
}
