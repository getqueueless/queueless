// This file did not exist yet when the public status page needed it, so it
// was created here per the task's fallback instructions. One change from the
// given stub: the shared client factories in src/lib/supabase/ export
// `createClient()` (a factory), not a `supabase` singleton, so the browser
// client is constructed directly in this file instead of importing one that
// doesn't exist. It also picks up the requested `realtime: { worker: true }`
// option, which the shared factory does not set.
'use client'
import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { RealtimeChannel } from '@supabase/supabase-js'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { realtime: { worker: true } },
)

// ponytail: onEvent's payload is `any` on purpose -- the callers of this hook
// each narrow it to their own row/payload shape with their own inline type on
// the callback param, contextually typed at each call site. Giving the hook
// itself a real generic would need every existing caller's own annotation
// rewritten to match; not worth it for one shared plumbing file.
//
// broadcastEvent switches this channel from a `postgres_changes` listener
// (table/filter, the original mode -- still what most callers use) to a
// `broadcast` listener instead. Needed because postgres_changes never fires
// on this stack at all: the self-hosted supabase_realtime publication has
// zero member tables (see docs/API_CONTRACT.md's "Realtime topics"), so no
// caller of this hook actually receives anything from that mode. Migration
// 0044 adds real DB-side broadcasts instead, on topics named `token:<id>`
// and `service:<id>` (channelName IS the topic name for this mode -- pass
// one of those, not an arbitrary label), both firing a `token_update` event.
// `table`/`filter` are ignored when broadcastEvent is set.
//
// Ref-counted per channelName: two hooks subscribing to the same topic (e.g.
// a live department strip and a token tracker both on `service:<id>` when
// both happen to be mounted on the same page) used to each open their OWN
// RealtimeChannel object for the identical topic on this module's one shared
// socket. Only whichever instance's own reconnect logic happened to fire
// (tab visibility, CHANNEL_ERROR) knew to rebuild its channel -- the other
// kept dispatching off (or waiting on) a channel object the server had
// already dropped, silently dead until its own unrelated re-render
// happened to reconnect it. One real channel per topic now; every hook
// instance just adds/removes its own callback from that topic's listener
// set, and the shared entry owns the one reconnect/backoff cycle.
type Listener = (payload: unknown) => void

type Entry = {
  channel: RealtimeChannel
  listeners: Set<Listener>
  table?: string
  filter?: string
  broadcastEvent?: string
  retry: number
  timer: ReturnType<typeof setTimeout> | null
  handleVisible: () => void
  handleOnline: () => void
}

const registry = new Map<string, Entry>()

function dispatch(channelName: string, payload: unknown) {
  registry.get(channelName)?.listeners.forEach((fn) => fn(payload))
}

function buildChannel(channelName: string, table: string | undefined, filter: string | undefined, broadcastEvent: string | undefined): RealtimeChannel {
  const channel = supabase.channel(channelName)
  if (broadcastEvent) {
    channel.on('broadcast', { event: broadcastEvent }, ({ payload }) => dispatch(channelName, payload))
  } else {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: table!, filter }, (payload) => dispatch(channelName, payload))
  }
  return channel
}

function subscribeEntry(channelName: string) {
  const entry = registry.get(channelName)
  if (!entry) return
  entry.channel.subscribe((status) => {
    const current = registry.get(channelName)
    if (!current) return
    if (status === 'SUBSCRIBED') { current.retry = 0; return }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      const attempt = current.retry++
      const delay = Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 500
      if (current.timer) clearTimeout(current.timer)
      current.timer = setTimeout(() => reconnect(channelName), delay)
    }
  })
}

function reconnect(channelName: string) {
  const entry = registry.get(channelName)
  if (!entry) return
  supabase.removeChannel(entry.channel)
  entry.channel = buildChannel(channelName, entry.table, entry.filter, entry.broadcastEvent)
  subscribeEntry(channelName)
}

function acquire(channelName: string, table: string | undefined, filter: string | undefined, broadcastEvent: string | undefined, onEvent: Listener) {
  let entry = registry.get(channelName)
  if (!entry) {
    const handleVisible = () => { if (document.visibilityState === 'visible') reconnect(channelName) }
    const handleOnline = () => reconnect(channelName)
    entry = {
      channel: buildChannel(channelName, table, filter, broadcastEvent),
      listeners: new Set(),
      table,
      filter,
      broadcastEvent,
      retry: 0,
      timer: null,
      handleVisible,
      handleOnline,
    }
    registry.set(channelName, entry)
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('online', handleOnline)
    subscribeEntry(channelName)
  }
  entry.listeners.add(onEvent)
}

function release(channelName: string, onEvent: Listener) {
  const entry = registry.get(channelName)
  if (!entry) return
  entry.listeners.delete(onEvent)
  if (entry.listeners.size > 0) return
  if (entry.timer) clearTimeout(entry.timer)
  document.removeEventListener('visibilitychange', entry.handleVisible)
  window.removeEventListener('online', entry.handleOnline)
  supabase.removeChannel(entry.channel)
  registry.delete(channelName)
}

export function useResilientChannel({ channelName, table, filter, broadcastEvent, onEvent }: {
  channelName: string; table?: string; filter?: string; broadcastEvent?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: (payload: any) => void
}) {
  useEffect(() => {
    acquire(channelName, table, filter, broadcastEvent, onEvent)
    return () => {
      release(channelName, onEvent)
    }
  }, [channelName, table, filter, broadcastEvent, onEvent])
}

/** Calls `onEvent` (keep it stable) on every `token_update` broadcast for any of these services. */
export function useServiceBroadcasts(serviceIds: string[], onEvent: () => void) {
  const key = [...new Set(serviceIds)].sort().join(",")
  useEffect(() => {
    if (!key) return
    const topics = key.split(",").map((id) => `service:${id}`)
    topics.forEach((t) => acquire(t, undefined, undefined, "token_update", onEvent))
    return () => topics.forEach((t) => release(t, onEvent))
  }, [key, onEvent])
}
