import { useEffect, useRef, useState } from 'react'

/**
 * usePullToRefresh — touch-based pull-to-refresh for a scrollable element.
 *
 * Returns { containerRef, pullDistance, refreshing }.
 * Attach containerRef to the scrollable div.
 * onRefresh is called when the user pulls past threshold.
 */
export function usePullToRefresh(onRefresh, { threshold = 72 } = {}) {
  const containerRef = useRef(null)
  const startY = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const refreshing$ = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onTouchStart(e) {
      // Only activate when scrolled to top
      if (el.scrollTop > 2) return
      startY.current = e.touches[0].clientY
    }

    function onTouchMove(e) {
      if (refreshing$.current) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPullDistance(0); return }
      // Only intercept when at top of scroll
      if (el.scrollTop > 2 && dy > 0) return
      // Rubber-band: slow down past threshold
      const dist = dy > threshold ? threshold + (dy - threshold) * 0.25 : dy
      setPullDistance(Math.min(dist, threshold + 40))
    }

    async function onTouchEnd() {
      if (refreshing$.current) return
      if (pullDistance >= threshold) {
        setRefreshing(true)
        refreshing$.current = true
        try { await onRefresh() } catch { /* non-fatal */ }
        setRefreshing(false)
        refreshing$.current = false
      }
      setPullDistance(0)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onRefresh, pullDistance, threshold])

  return { containerRef, pullDistance, refreshing }
}
