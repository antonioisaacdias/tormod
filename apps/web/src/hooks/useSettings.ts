import { useCallback, useEffect, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/api'
import type { Settings } from '@/lib/serverTypes'

export function useSettings(open: boolean) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch((err) => console.error('getSettings', err))
    return () => {
      cancelled = true
    }
  }, [open])

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSaving(true)
    try {
      const next = await saveSettings(patch)
      setSettings(next)
    } catch (err) {
      console.error('saveSettings', err)
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, saving, save }
}
