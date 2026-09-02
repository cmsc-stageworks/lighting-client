import { app } from 'electron'

export function setLaunchAtLogin(on: boolean, openAsHidden: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  try {
    app.setLoginItemSettings({
      openAtLogin: on,
      openAsHidden,
      args: on && openAsHidden ? ['--hidden'] : []
    })
  } catch {
    /* unsupported in some dev setups */
  }
}

export function startedHidden(): boolean {
  return process.argv.includes('--hidden')
}

export function isHeadless(): boolean {
  return process.argv.includes('--headless')
}
