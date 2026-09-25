import { SymbolView } from 'expo-symbols';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardShadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import { Radius, Tones, gradient, type IconName, type Tone } from './tokens';
import { UIText } from './UIText';

const CHEVRON: IconName = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

/** An iOS-Settings-style group: a small title, then rows in one card with inset hairlines. */
export function ListGroup({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {title ? (
        <UIText variant="secondaryStrong" color="inkSecondary" style={styles.groupTitle} accessibilityRole="header">
          {title}
        </UIText>
      ) : null}
      <View style={[styles.card, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.separator, { backgroundColor: theme.hairline }]} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <UIText variant="secondary" style={styles.footer}>
          {footer}
        </UIText>
      ) : null}
    </View>
  );
}

export type ListRowProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** The icon tile's colour family; `danger` for destructive rows. */
  tone?: Tone | 'danger';
  /** Short text on the right (a current value, a count). */
  value?: string;
  /** Makes the row one tap target with a chevron. Leave it off when `trailing` holds a control. */
  onPress?: () => void;
  /** A control on the right (Switch, ThemeToggle). Never combine with onPress. */
  trailing?: ReactNode;
  destructive?: boolean;
  accessibilityHint?: string;
};

/** A 56pt row: icon tile, title (+ subtitle), then a value, a control, or a chevron. */
export function ListRow({ title, subtitle, icon, tone = 'teal', value, onPress, trailing, destructive, accessibilityHint }: ListRowProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const t = tone === 'danger' ? null : Tones[tone][dark ? 'dark' : 'light'];
  const tile = t ? gradient(t.from, t.to) : { backgroundColor: theme.dangerSoft };
  const iconColor = t ? t.icon : theme.danger;

  const body = (
    <>
      {icon ? (
        <View style={[styles.iconTile, tile]}>
          <SymbolView name={icon} size={18} tintColor={iconColor} />
        </View>
      ) : null}
      <View style={styles.text}>
        <UIText color={destructive ? 'danger' : 'ink'} numberOfLines={1}>
          {title}
        </UIText>
        {subtitle ? (
          <UIText variant="secondary" numberOfLines={2}>
            {subtitle}
          </UIText>
        ) : null}
      </View>
      {value ? (
        <UIText variant="secondary" numberOfLines={1} style={styles.value}>
          {value}
        </UIText>
      ) : null}
      {trailing}
      {onPress && !trailing ? <SymbolView name={CHEVRON} size={16} tintColor={theme.inkMuted} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceSunken }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupTitle: { paddingHorizontal: 4 },
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  iconTile: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  value: { maxWidth: '40%', textAlign: 'right' },
  footer: { paddingHorizontal: 4 },
});
