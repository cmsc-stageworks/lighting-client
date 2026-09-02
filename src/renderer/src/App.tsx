import React, { useEffect, useState } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Spinner } from './components/ui'
import { useConfig } from './store/config'
import { useRuntime } from './store/runtime'
import { useEvents } from './store/events'
import { useToasts } from './store/toasts'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { ScenesPage } from './features/scenes/ScenesPage'
import { MappingsPage } from './features/mappings/MappingsPage'
import { ThoriumPage } from './features/thorium/ThoriumPage'
import { MqttPage } from './features/mqtt/MqttPage'
import { OutputsPage } from './features/outputs/OutputsPage'
import { SimulatorsPage } from './features/simulators/SimulatorsPage'
import { LayersPage } from './features/layers/LayersPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { FirstRunWizard } from './features/wizard/FirstRunWizard'

function WizardGate({ children }: { children: React.JSX.Element }): React.JSX.Element {
  const done = useConfig((s) => s.config?.settings.wizardCompleted ?? true)
  return done ? children : <Navigate to="/wizard" replace />
}

const router = createHashRouter([
  { path: '/wizard', element: <FirstRunWizard /> },
  {
    path: '/',
    element: (
      <WizardGate>
        <AppShell />
      </WizardGate>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'scenes', element: <ScenesPage /> },
      { path: 'mappings', element: <MappingsPage /> },
      { path: 'setup/thorium', element: <ThoriumPage /> },
      { path: 'setup/mqtt', element: <MqttPage /> },
      { path: 'setup/outputs', element: <OutputsPage /> },
      { path: 'setup/simulators', element: <SimulatorsPage /> },
      { path: 'setup/layers', element: <LayersPage /> },
      { path: 'setup/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const theme = useConfig((s) => s.config?.settings.theme ?? 'dark')

  useEffect(() => {
    void Promise.all([
      useConfig.getState().init(),
      useRuntime.getState().init(),
      useEvents.getState().init()
    ]).then(() => {
      useToasts.getState().init()
      setReady(true)
    })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const apply = (): void => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('light', !dark)
      root.classList.toggle('dark', dark)
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center gap-3 text-muted">
        <Spinner /> Starting…
      </div>
    )
  }
  return <RouterProvider router={router} />
}
