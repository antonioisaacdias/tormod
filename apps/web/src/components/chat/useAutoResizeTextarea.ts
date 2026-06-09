import { useCallback, useLayoutEffect, useRef } from 'react'

export function useAutoResizeTextarea(maxHeight: number, value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const element = ref.current
    if (!element) {
      return
    }
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
  }, [maxHeight])

  useLayoutEffect(() => {
    resize()
  }, [resize, value])

  return { ref }
}
