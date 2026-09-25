// This file did not exist yet when the public status page needed it, so it
// was created here per the task's fallback instructions. One change from the
// given stub: the shared client factories in src/lib/supabase/ export
// `createClient()` (a factory), not a `supabase` singleton, so the browser
// client is constructed directly in this file instead of importing one that
// doesn't exist. It also picks up the requested `realtime: { worker: true }`
// option, which the shared factory does not set.
'use client'
import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { realtime: { worker: true } },
)

// ponytail: onEvent's payload is `any` on purpose -- the 4 pages calling this
// hook each narrow it to their own row shape (TokenRow, BoardCounter, ...)
// with their own inline type on the callback param, contextually typed at
// each call site. Giving the hook itself a real generic would need every
// existing caller's own annotation rewritten to match; not worth it for one
// shared plumbing file.
export function useResilientChannel({ channelName, table, filter, onEvent }: {
  channelName: string; table: string; filter?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: (payload: any) => void
}) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
    const teardown = () => {
      clearTimer()
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    }
    function connect() {
      if (!mountedRef.current) return
      teardown()
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onEvent)
        .subscribe((status) => {
          if (!mountedRef.current) return
          if (status === 'SUBSCRIBED') { retryRef.current = 0; return }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            const attempt = retryRef.current++
            const delay = Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 500
            clearTimer()
            timerRef.current = setTimeout(connect, delay)
          }
        })
      channelRef.current = channel
    }
    connect()
    const handleVisible = () => { if (document.visibilityState === 'visible') connect() }
    const handleOnline = () => connect()
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', handleOnline)
    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('online', handleOnline)
      teardown()
    }
  }, [channelName, table, filter, onEvent])
}
