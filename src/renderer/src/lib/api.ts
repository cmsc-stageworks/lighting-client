import type { IpcArgs, IpcChannel, IpcPush, IpcPushChannel, IpcResult } from '@shared/types/ipc'

export function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<Awaited<IpcResult<C>>> {
  return window.api.invoke(channel, ...args)
}

export function on<C extends IpcPushChannel>(
  channel: C,
  listener: (payload: IpcPush[C]) => void
): () => void {
  return window.api.on(channel, listener)
}
