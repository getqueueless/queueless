import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import medium from 'expo-symbols/androidWeights/medium';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { MAX_DOTS, freshLane, moveLane, stageOf, type TrackerStatus } from './queue-lane';

export type { TrackerStatus };

export type QueueTrackerProps = {
  status: TrackerStatus;
  /** Waiting tokens ordered ahead of this one; null when unknown. */
  ahead: number | null;
  /** Current predicted wait, whole minutes; null when there is no estimate. */
  etaMinutes: number | null;
  /** The first estimate this token got; the ring's 0%. */
  etaAtJoin: number | null;
  /** The assigned counter's name ("3", "Counter 3"); null until called. */
  counterCode: string | null;
  /** The service's most recently called token code. */
  nowServingNumber: string | null;
  serviceName: string | null;
};

// Same copy, timings and curves as apps/web's QueueTracker.
const ENDED: Partial<Record<TrackerStatus, { label: string; text: string }>> = {
  skipped: { label: 'Skipped', text: 'You were skipped. Check in with the counter.' },
  no_show: { label: 'No-show', text: 'Marked as a no-show. See the counter to be re-added.' },
  cancelled: { label: 'Cancelled', text: 'This token was cancelled.' },
};

const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);
const SPRING = { damping: 20, stiffness: 260 }; // settles in ~420 ms with a small overshoot
const LANE_H = 56;
const LINE_Y = LANE_H / 2 + 4;
const SLOT_W = 30;
const ICON = 33;

// SF Symbols on iOS, Material Symbols on Android and web (expo-symbols, already installed).
type SymbolName = SymbolViewProps['name'];
const ICONS: SymbolName[] = [
  { ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' },
  { ios: 'clock', android: 'schedule', web: 'schedule' },
  { ios: 'person', android: 'person', web: 'person' },
  { ios: 'bell', android: 'notifications', web: 'notifications' },
  { ios: 'checkmark', android: 'check', web: 'check' },
];
const ICON_ENDED: SymbolName = { ios: 'xmark', android: 'close', web: 'close' };

/**
 * The token screen's live tracker: ETA ring, queue lane, stage bar, now serving. It renders only
 * what it is given: every number is real data from the screen, and nothing here advances on its
 * own clock. Reduce Motion shows the same states, still.
 */
function QueueTrackerView({
  status,
  ahead,
  etaMinutes,
  etaAtJoin,
  counterCode,
  nowServingNumber,
  serviceName,
}: QueueTrackerProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Called or being served: nobody is ahead any more, you are at the counter.
  const atCounter = status === 'called' || status === 'serving';
  const laneAhead = atCounter ? 0 : ahead;
  const [lane, setLane] = useState(() => freshLane(laneAhead));
  // Adjust state while rendering when `ahead` changes (React's documented pattern), so the lane
  // moves in the same commit as the new number.
  if (laneAhead !== lane.ahead) setLane(moveLane(lane, laneAhead));

  const ended = ENDED[status];
  const stage = stageOf(status, ahead);
  const counter = !counterCode ? 'Counter' : /^counter\b/i.test(counterCode) ? counterCode : `Counter ${counterCode}`;
  const live = status === 'waiting' || status === 'called' || status === 'serving';

  const labels = ['Booked', 'Waiting', 'You’re next', status === 'serving' ? 'With the doctor' : 'Called', ended?.label ?? 'Done'];
  const detail = ended
    ? ended.text
    : status === 'pending_payment'
      ? 'Payment pending.'
      : status === 'called'
        ? `Go to ${counter}.`
        : status === 'serving'
          ? 'With the doctor.'
          : status === 'done'
            ? 'Visit complete. Thank you.'
            : null;

  // The ring: share of the first estimate already waited out.
  const progress = atCounter
    ? 1
    : etaMinutes !== null && etaAtJoin
      ? Math.min(1, Math.max(0, 1 - etaMinutes / etaAtJoin))
      : 0;
  const ringLabel = atCounter
    ? 'Your turn now.'
    : etaMinutes === null
      ? 'No wait estimate yet.'
      : `Estimated wait about ${etaMinutes} ${etaMinutes === 1 ? 'minute' : 'minutes'}, ${Math.round(progress * 100)}% of it done.`;

  const overflow = laneAhead !== null && laneAhead > MAX_DOTS ? laneAhead - MAX_DOTS : 0;
  const youAt = lane.dots.length + (overflow ? 1 : 0);
  const laneLabel =
    laneAhead === null
      ? ''
      : `${laneAhead === 0 ? 'Nobody' : laneAhead === 1 ? '1 person' : `${laneAhead} people`} ahead of you${
          serviceName ? ` in the ${serviceName} queue` : ''
        }, then ${counter}.`;

  // Announce each stage change (not the first render): iOS and Android both read this.
  const message = `Step ${stage + 1} of 5: ${labels[stage]}.${detail ? ` ${detail}` : ''}`;
  const announced = useRef(message);
  useEffect(() => {
    if (announced.current === message) return;
    announced.current = message;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const [trackWidth, setTrackWidth] = useState(0);
  const step = Math.min(26, trackWidth / 10);
  // Ten slots always fit: on a narrow track the shapes shrink with the step, the spacing never.
  const fit = Math.min(1, step / 28);
  const dotStyle = { width: 14 * fit, height: 14 * fit, borderRadius: 7 * fit, backgroundColor: theme.inkMuted };
  const ringSize = Math.round(Math.min(156, Math.max(128, width * 0.36)));

  return (
    <View style={styles.tracker}>
      {live ? (
        <EtaRing
          progress={progress}
          size={ringSize}
          track={theme.hairline}
          arc={theme.primary}
          reduceMotion={reduceMotion}
          label={ringLabel}>
          {atCounter ? (
            <Text style={[styles.ringNow, { color: theme.primaryText }]}>Now</Text>
          ) : etaMinutes === null ? (
            <Text style={[styles.ringNone, { color: theme.inkSecondary }]}>No estimate yet</Text>
          ) : (
            <>
              <Text style={[styles.ringMins, { color: theme.ink, fontSize: Math.min(40, Math.max(32, width * 0.09)) }]}>
                ~{Math.round(etaMinutes)}
              </Text>
              <Text style={[styles.ringUnit, { color: theme.inkMuted }]}>min</Text>
            </>
          )}
        </EtaRing>
      ) : null}

      {live ? <Summary line={summaryLine(status, ahead, etaMinutes, counter)} progress={progress} /> : null}

      {live && laneAhead !== null ? (
        <View style={styles.laneWrap}>
          <View accessible accessibilityRole="image" accessibilityLabel={laneLabel} style={styles.lane}>
            <View style={styles.laneTrack} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
              <View style={styles.laneLine}>
                <View style={[styles.laneDash, { borderColor: theme.hairlineStrong }]} />
              </View>
              {step > 0 ? (
                <>
                  {lane.leaving.map((d) => (
                    <Slot key={d.id} i={d.i} step={step} leaving reduceMotion={reduceMotion}>
                      <View style={dotStyle} />
                    </Slot>
                  ))}
                  {lane.dots.map((d) => (
                    <Slot key={d.id} i={d.i} step={step} enter={d.enter} reduceMotion={reduceMotion}>
                      <View style={dotStyle} />
                    </Slot>
                  ))}
                  {overflow > 0 ? (
                    <Slot i={lane.dots.length} step={step} reduceMotion={reduceMotion}>
                      <Text style={[styles.more, { color: theme.inkSecondary }]}>+{overflow}</Text>
                    </Slot>
                  ) : null}
                  <Slot i={youAt} step={step} reduceMotion={reduceMotion}>
                    {/* The gap ring is the token screen's own canvasSoft, so the dashed line stops short. */}
                    <View
                      style={[
                        styles.youHalo,
                        { width: 28 * fit, height: 28 * fit, borderColor: theme.primary, backgroundColor: theme.canvasSoft },
                      ]}>
                      <View style={{ width: 18 * fit, height: 18 * fit, borderRadius: 9 * fit, backgroundColor: theme.primary }} />
                    </View>
                    <Text style={[styles.youTag, { color: theme.primaryText }]}>You</Text>
                  </Slot>
                </>
              ) : null}
            </View>
            <View style={[styles.counter, { backgroundColor: theme.primarySoft }]}>
              <Text style={[styles.counterText, { color: theme.primaryText }]}>{counter}</Text>
            </View>
          </View>
          <View accessibilityLiveRegion="polite" style={styles.noteRow}>
            {lane.added > 0 ? (
              <Animated.Text
                key={lane.next}
                entering={reduceMotion ? undefined : FadeInUp.duration(300)}
                style={[styles.note, { color: theme.inkSecondary }]}>
                {lane.added === 1 ? 'Priority patient added' : `${lane.added} priority patients added`}
              </Animated.Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <StageBar labels={labels} stage={stage} ended={!!ended} reduceMotion={reduceMotion} />

      {detail ? (
        <Text
          style={
            status === 'called'
              ? [styles.detailCalled, { color: theme.primaryText, fontSize: Math.min(28, Math.max(22, width * 0.06)) }]
              : [styles.detail, { color: theme.inkSecondary }]
          }>
          {detail}
        </Text>
      ) : null}

      {live && nowServingNumber ? (
        <View style={[styles.nowServing, { borderTopColor: theme.hairline }]}>
          <Text style={[styles.nowLabel, { color: theme.inkSecondary }]}>Now serving</Text>
          <Animated.Text
            key={nowServingNumber}
            entering={reduceMotion ? undefined : FadeInUp.duration(300)}
            style={[styles.nowCode, { color: theme.ink }]}>
            {nowServingNumber}
          </Animated.Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * No react-native-svg in the app, so the arc is two clipped half-rings: each half of the circle
 * shows a half-ring (two coloured border sides) rotated into view by the progress.
 */
function EtaRing({
  progress,
  size,
  track,
  arc,
  reduceMotion,
  label,
  children,
}: {
  progress: number;
  size: number;
  track: string;
  arc: string;
  reduceMotion: boolean;
  label: string;
  children: ReactNode;
}) {
  const p = useSharedValue(progress);
  useEffect(() => {
    p.set(reduceMotion ? progress : withTiming(progress, { duration: 600, easing: EASE_OUT }));
  }, [progress, reduceMotion, p]);

  // Top + right borders make a half-ring spanning 315°→135°; +45° puts it on the right half.
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-135 + Math.min(p.get(), 0.5) * 360}deg` }],
  }));
  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${45 + Math.max(p.get() - 0.5, 0) * 360}deg` }],
  }));

  const half = size / 2;
  const circle: ViewStyle = { position: 'absolute', width: size, height: size, borderRadius: half, borderWidth: Math.round(size / 15) };
  const halfRing: ViewStyle = {
    ...circle,
    borderTopColor: arc,
    borderRightColor: arc,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.ring, { width: size, height: size }]}>
      <View style={[circle, { borderColor: track }]} />
      <View style={[styles.ringHalf, { left: half, width: half, height: size }]}>
        <Animated.View style={[halfRing, { left: -half }, rightStyle]} />
      </View>
      <View style={[styles.ringHalf, { left: 0, width: half, height: size }]}>
        <Animated.View style={[halfRing, { left: 0 }, leftStyle]} />
      </View>
      <View style={styles.ringCentre}>{children}</View>
    </View>
  );
}

/**
 * One place in the lane, counted from the counter end (slot 0 is the front of the line). Moves
 * with a spring when its slot changes; front arrivals drop in, refills fade up from the back, and
 * the person who was called leaves toward the counter.
 */
function Slot({
  i,
  step,
  enter,
  leaving = false,
  reduceMotion,
  children,
}: {
  i: number;
  step: number;
  enter?: 'front' | 'back';
  leaving?: boolean;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const x = useSharedValue(-i * step);
  const a = useSharedValue(reduceMotion ? (leaving ? 0 : 1) : enter ? 0 : 1);

  useEffect(() => {
    x.set(reduceMotion ? -i * step : withSpring(-i * step, SPRING));
  }, [i, step, reduceMotion, x]);

  useEffect(() => {
    if (reduceMotion) return;
    if (leaving) a.set(withTiming(0, { duration: 420, easing: EASE_OUT }));
    else if (enter === 'front') a.set(withSpring(1, SPRING));
    else if (enter === 'back') a.set(withTiming(1, { duration: 420, easing: EASE_OUT }));
    // Mount only: each person enters or leaves once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const v = a.get();
    return {
      opacity: Math.min(1, v),
      transform: [
        { translateX: x.get() + (leaving ? (1 - v) * step * 1.4 : 0) },
        { translateY: enter === 'front' && !leaving ? (1 - v) * -24 : 0 },
        { scale: leaving || enter === 'front' ? 0.5 + 0.5 * v : enter === 'back' ? 0.3 + 0.7 * v : 1 },
      ],
    };
  });

  return <Animated.View style={[styles.slot, animatedStyle]}>{children}</Animated.View>;
}

function StageBar({
  labels,
  stage,
  ended,
  reduceMotion,
}: {
  labels: string[];
  stage: number;
  ended: boolean;
  reduceMotion: boolean;
}) {
  const theme = useTheme();
  const target = ended ? 0 : stage / 4;
  const fill = useSharedValue(target);
  useEffect(() => {
    fill.set(reduceMotion ? target : withTiming(target, { duration: 600, easing: EASE_OUT }));
  }, [target, reduceMotion, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }));

  return (
    <View accessible accessibilityLabel={`Progress: step ${stage + 1} of 5, ${labels[stage]}`} style={styles.stages}>
      <View style={[styles.rail, { backgroundColor: theme.hairline }]} />
      <Animated.View style={[styles.rail, styles.railFill, { backgroundColor: theme.primaryText }, fillStyle]} />
      {labels.map((label, i) => {
        const state = i < stage ? 'past' : i === stage ? 'current' : 'next';
        // Skipped / no-show / cancelled: every step goes grey and the last becomes the outcome, red.
        const look =
          ended && state === 'current'
            ? { border: theme.danger, fill: theme.dangerSoft, icon: theme.danger, text: theme.danger }
            : state === 'past' && !ended
              ? { border: theme.primaryText, fill: theme.primaryText, icon: theme.surface, text: theme.inkMuted }
              : state === 'current'
                ? { border: theme.primary, fill: theme.primary, icon: theme.onPrimary, text: theme.ink }
                : { border: theme.hairlineStrong, fill: theme.surface, icon: theme.inkMuted, text: theme.inkMuted };
        return (
          <View key={i} style={styles.stage}>
            <View style={styles.stageIconWrap}>
              {state === 'current' && !ended && !reduceMotion ? <Pulse key={stage} color={theme.primary} /> : null}
              <View style={[styles.stageIcon, { borderColor: look.border, backgroundColor: look.fill }]}>
                <SymbolView
                  name={ended && i === 4 ? ICON_ENDED : ICONS[i]}
                  size={18}
                  tintColor={look.icon}
                  weight={{ ios: 'medium', android: medium }}
                />
              </View>
            </View>
            <Text
              style={[styles.stageLabel, { color: look.text }, state === 'current' && styles.stageLabelCurrent]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// Three soft pulses on arriving at a stage, then still (WCAG 2.2.2).
function Pulse({ color }: { color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1600, easing: EASE_OUT }), 3, false));
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - t.get()),
    transform: [{ scale: 1 + 0.6 * t.get() }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.pulse, { backgroundColor: color }, style]} />;
}

/** "3 ahead · ~12 min" (or where to go), plain text that renders on every engine. */
function summaryLine(status: TrackerStatus, ahead: number | null, etaMinutes: number | null, counter: string) {
  if (status === 'called') return `Go to ${counter}`;
  if (status === 'serving') return 'With the doctor now';
  const place = ahead === null ? null : ahead === 0 ? 'You’re next' : ahead === 1 ? '1 person ahead' : `${ahead} people ahead`;
  const wait = etaMinutes === null ? null : `~${Math.round(etaMinutes)} min`;
  return [place, wait].filter(Boolean).join(' · ') || 'Waiting in line';
}

/**
 * The primary progress readout: a text line and a plain View bar (a width percentage, no
 * transforms or clipping), so it shows on every platform even if the decorative ring can't draw.
 */
function Summary({ line, progress }: { line: string; progress: number }) {
  const theme = useTheme();
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <View style={styles.summary} accessible accessibilityLabel={`${line}. ${pct}% of the wait done.`}>
      <Text style={[styles.summaryLine, { color: theme.ink }]}>{line}</Text>
      <View style={[styles.barTrack, { backgroundColor: theme.hairline }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.primary }]} />
      </View>
    </View>
  );
}

/** If anything in the full tracker throws on a device, the screen still shows the essentials. */
function TrackerFallback(props: QueueTrackerProps) {
  const theme = useTheme();
  const counter = !props.counterCode ? 'the counter' : /^counter\b/i.test(props.counterCode) ? props.counterCode : `Counter ${props.counterCode}`;
  const progress =
    props.status === 'called' || props.status === 'serving'
      ? 1
      : props.etaMinutes !== null && props.etaAtJoin
        ? 1 - props.etaMinutes / props.etaAtJoin
        : 0;
  return (
    <View style={styles.tracker}>
      <Summary line={summaryLine(props.status, props.ahead, props.etaMinutes, counter)} progress={progress} />
      {props.nowServingNumber ? (
        <Text style={[styles.nowLabel, { color: theme.inkSecondary, textAlign: 'center' }]}>Now serving {props.nowServingNumber}</Text>
      ) : null}
    </View>
  );
}

class TrackerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.log('[QueueTracker] full tracker failed, showing the simple one:', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function QueueTracker(props: QueueTrackerProps) {
  return (
    <TrackerBoundary fallback={<TrackerFallback {...props} />}>
      <QueueTrackerView {...props} />
    </TrackerBoundary>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 10 },
  summaryLine: { fontFamily: Fonts?.poppinsBold, fontSize: 22, lineHeight: 28, textAlign: 'center' },
  barTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  tracker: { alignSelf: 'stretch', gap: 24 },

  ring: { alignSelf: 'center' },
  ringHalf: { position: 'absolute', top: 0, overflow: 'hidden' },
  ringCentre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringMins: { fontFamily: Fonts?.poppinsBold, lineHeight: 44, fontVariant: ['tabular-nums'] },
  ringUnit: { marginTop: 2, fontFamily: Fonts?.poppinsRegular, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  ringNow: { fontFamily: Fonts?.poppinsBold, fontSize: 30, lineHeight: 36 },
  ringNone: { maxWidth: 96, fontFamily: Fonts?.poppinsRegular, fontSize: 14, lineHeight: 19, textAlign: 'center' },

  laneWrap: { gap: 4 },
  lane: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  laneTrack: { flex: 1, minWidth: 0, height: LANE_H },
  // iOS draws no dashed single-side border, so a dashed box is clipped to its top edge.
  laneLine: { position: 'absolute', top: LINE_Y - 1, left: 0, right: 0, height: 2, overflow: 'hidden' },
  laneDash: { height: 6, borderWidth: 2, borderStyle: 'dashed', borderRadius: 1 },
  slot: {
    position: 'absolute',
    right: 0,
    top: LINE_Y - 14,
    width: SLOT_W,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: { fontFamily: Fonts?.poppinsBold, fontSize: 12, fontVariant: ['tabular-nums'] },
  youHalo: { borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  youTag: {
    position: 'absolute',
    bottom: 28 + 4,
    fontFamily: Fonts?.poppinsBold,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  counter: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  counterText: { fontFamily: Fonts?.poppinsBold, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase' },
  noteRow: { minHeight: 18, alignItems: 'center' },
  note: { fontFamily: Fonts?.poppinsRegular, fontSize: 13, lineHeight: 18 },

  stages: { flexDirection: 'row' },
  // The rail runs icon centre to icon centre; the fill scales, never resizes.
  rail: { position: 'absolute', top: 15, left: '10%', right: '10%', height: 3, borderRadius: 2 },
  railFill: { transformOrigin: 'left' },
  stage: { flex: 1, alignItems: 'center', gap: 6 },
  stageIconWrap: { width: ICON, height: ICON },
  stageIcon: {
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: { position: 'absolute', width: ICON, height: ICON, borderRadius: ICON / 2 },
  stageLabel: { fontFamily: Fonts?.poppinsRegular, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  stageLabelCurrent: { fontFamily: Fonts?.poppinsBold },

  detail: { fontFamily: Fonts?.poppinsRegular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  // Called gets the loudest line, not a takeover.
  detailCalled: { fontFamily: Fonts?.poppinsBold, lineHeight: 32, textAlign: 'center' },

  nowServing: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  nowLabel: { fontFamily: Fonts?.poppinsRegular, fontSize: 14 },
  nowCode: { fontFamily: Fonts?.mono, fontSize: 17, fontWeight: '700' },
});
