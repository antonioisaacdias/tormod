export type MeterTone = 'arc' | 'approve' | 'danger'

export function usageTone(percentage: number): MeterTone {
  if (percentage >= 90) {
    return 'danger'
  }
  if (percentage >= 70) {
    return 'approve'
  }
  return 'arc'
}
