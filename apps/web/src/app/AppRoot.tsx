import { useState } from 'react'
import { isNative, getServerUrl } from '@/lib/platform'
import { ServerScreen } from '@/components/auth/ServerScreen'
import { App } from './App'

export function AppRoot() {
  const [hasServer, setHasServer] = useState(!isNative() || getServerUrl() !== null)
  if (!hasServer) {
    return <ServerScreen onConnected={() => setHasServer(true)} />
  }
  return <App />
}
