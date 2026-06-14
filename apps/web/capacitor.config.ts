import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'br.com.diaslabs.tormod',
  appName: 'Tormod',
  webDir: 'dist',
  android: {
    androidScheme: 'http',
  },
}

export default config
