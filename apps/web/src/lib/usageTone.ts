import type { Tone } from '@/types/tone'

export function usageTone(percentage: number): Tone {
  if (percentage >= 90) {
    return 'danger'
  }
  if (percentage >= 70) {
    return 'approve'
  }
  return 'arc'
}
