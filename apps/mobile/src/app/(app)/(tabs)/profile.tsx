import { useRouter, type Href } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestUpdateCheck } from '@/components/update-sheet';
import { Avatar, Button, Chip, ListGroup, ListRow, SectionHeader, UIText, type IconName } from '@/components/ui';
import { useElderlyMode } from '@/hooks/use-elderly-mode';
import { useTheme } from '@/hooks/use-theme';
import { appVersion } from '@/lib/app-version';
import { setElderlyMode } from '@/lib/elderly-mode-preference';
import { getLanguagePreference, LANGUAGE_LABELS, setLanguagePreference, type LanguagePreference } from '@/lib/language-preference';
import { setAlertsEnabled, useAlertsEnabled } from '@/lib/notification-preference';
import { registerForPushNotificationsAsync, showLocalNotification, unregisterPushTokenAsync } from '@/lib/notifications';
import { signOut } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { getThemePreference, setThemePreference, subscribeThemePreference, type ThemePreference } from '@/lib/theme-preference';
import { showToast } from '@/lib/toast-store';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

const icon = (ios: string, md: string) => ({ ios, android: md, web: md }) as IconName;

const LANGUAGES: LanguagePreference[] = ['en', 'hi', 'pa'];
const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

type ProfileRow = { full_name: string | null; phone: string | null; city: string | null };

/**
 * The Profile tab as a hospital-app hub, grouped like iOS Settings: who you are, your health
 * records, preferences, help, and the app itself. Staff and admins get a Work group on top.
 */
export default function Profile() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;
  const { role } = useRole(userId);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [language, setLanguage] = useState(getLanguagePreference);
  const themePref = useSyncExternalStore(subscribeThemePreference, getThemePreference, getThemePreference);
  const largeText = useElderlyMode();
  const alerts = useAlertsEnabled();
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'none' | 'error'>('idle');
  const [signingOut, setSigningOut] = useState(false);
  const { version, build } = appVersion();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('full_name, phone, city')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(data as ProfileRow | null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function pickLanguage(pref: LanguagePreference) {
    setLanguagePreference(pref);
    setLanguage(pref);
    // Best-effort server copy so pushes arrive in this language; local storage stays primary.
    supabase.rpc('set_my_language', { p_language: pref }).then(({ error }) => {
      if (error) console.log('[profile] set_my_language failed (non-fatal):', error);
    });
  }

  function toggleAlerts(on: boolean) {
    setAlertsEnabled(on);
    if (on && userId) registerForPushNotificationsAsync(userId);
    if (!on) unregisterPushTokenAsync();
  }

  async function checkUpdates() {
    setUpdateState('checking');
    const result = await requestUpdateCheck();
    // An update opens the global update sheet itself; only the other outcomes need words here.
    setUpdateState(result === 'update' ? 'idle' : result);
  }

  async function doSignOut() {
    setSigningOut(true);
    const error = await signOut();
    if (error) {
      setSigningOut(false);
      showToast(error, 'error');
    }
  }

  function confirmSignOut() {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out of WaitWise on this device?')) doSignOut();
      return;
    }
    Alert.alert('Sign out?', 'You can sign back in any time. Your tokens stay on your account.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: doSignOut },
    ]);
  }

  const name = profile?.full_name?.trim() || 'Your profile';
  const go = (href: Href) => () => router.push(href);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.canvasSoft }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Profile" />

        <View style={[styles.header, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          <Avatar name={name} size={64} />
          <View style={styles.flex}>
            <UIText variant="title3" numberOfLines={1}>
              {name}
            </UIText>
            <UIText variant="secondary" numberOfLines={1}>
              {[profile?.phone, profile?.city].filter(Boolean).join(' · ') || 'Add your phone and city'}
            </UIText>
          </View>
          <Button label="Edit" size="md" variant="secondary" onPress={go('/(app)/name-entry')} accessibilityHint="Edit your name, phone, date of birth and address" />
        </View>

        {role === 'staff' || role === 'admin' ? (
          <ListGroup title="Work">
            <ListRow title="Switch to counter" subtitle="Call and serve patients" icon={icon('person.wave.2', 'support_agent')} tone="blue" onPress={go('/(app)/(tabs)/counter')} />
            {role === 'admin' ? (
              <ListRow title="Switch to admin" subtitle="Dashboard, doctors, payments" icon={icon('chart.bar', 'admin_panel_settings')} tone="blue" onPress={go('/(app)/(tabs)/admin')} />
            ) : null}
          </ListGroup>
        ) : null}

        <ListGroup title="My health">
          <ListRow title="My tokens & visits" subtitle="Live queue and past visits" icon={icon('ticket', 'confirmation_number')} onPress={go('/(app)/(tabs)/my-tokens')} />
          <ListRow title="Appointments" subtitle="Booked times with your doctors" icon={icon('calendar', 'calendar_month')} tone="orange" onPress={go('/(app)/(tabs)/my-tokens')} />
          <ListRow title="Payments & receipts" subtitle="Amounts, dates and refunds" icon={icon('creditcard', 'credit_card')} tone="green" onPress={go('/(app)/receipts' as Href)} />
          <ListRow title="Claim a paper ticket" subtitle="Add a desk-issued ticket to your account" icon={icon('qrcode', 'qr_code')} tone="amber" onPress={go('/(app)/claim-ticket')} />
        </ListGroup>

        <ListGroup title="Preferences">
          <View style={styles.block}>
            <UIText>Language</UIText>
            <View style={styles.chips}>
              {LANGUAGES.map((l) => (
                <Chip key={l} label={LANGUAGE_LABELS[l]} selected={language === l} onPress={() => pickLanguage(l)} />
              ))}
            </View>
          </View>
          <View style={styles.block}>
            <UIText>Theme</UIText>
            <View style={styles.chips}>
              {THEMES.map((t) => (
                <Chip key={t.value} label={t.label} selected={themePref === t.value} onPress={() => setThemePreference(t.value)} />
              ))}
            </View>
          </View>
          <ListRow
            title="Large text"
            subtitle="Everything 1.3× bigger"
            icon={icon('textformat.size', 'format_size')}
            tone="rose"
            switchValue={largeText}
            onSwitchChange={setElderlyMode}
          />
          <ListRow
            title="Queue alerts"
            subtitle="Tell me when my turn is near and when I'm called"
            icon={icon('bell', 'notifications')}
            tone="orange"
            switchValue={alerts}
            onSwitchChange={toggleAlerts}
          />
          {alerts ? (
            <ListRow
              title="Send a test alert"
              subtitle="See what 'your turn' looks like"
              icon={icon('bell.badge', 'notifications_active')}
              tone="orange"
              onPress={() => {
                showLocalNotification("It's almost your turn", 'OPD-042 · 2 ahead of you · go to General OPD').catch(() => {});
                showToast('Test alert sent', 'success');
              }}
            />
          ) : null}
        </ListGroup>

        <ListGroup title="Help & legal">
          <ListRow title="FAQ" subtitle="Search common questions" icon={icon('book', 'menu_book')} tone="blue" onPress={go('/(app)/help/faq' as Href)} />
          <ListRow title="Ask WaitWise" subtitle="Get an answer in your language" icon={icon('bubble.left.and.bubble.right', 'forum')} tone="teal" onPress={go('/(app)/help/ask' as Href)} />
          <ListRow title="How WaitWise works" icon={icon('questionmark.circle', 'help')} tone="blue" onPress={go({ pathname: '/(app)/help/[topic]', params: { topic: 'how' } } as Href)} />
          <ListRow title="Cancellation & refund policy" icon={icon('arrow.uturn.backward.circle', 'currency_exchange')} tone="green" onPress={go({ pathname: '/(app)/help/[topic]', params: { topic: 'refunds' } } as Href)} />
          <ListRow title="Privacy" subtitle="What we store and why" icon={icon('lock', 'lock')} tone="teal" onPress={go({ pathname: '/(app)/help/[topic]', params: { topic: 'privacy' } } as Href)} />
        </ListGroup>

        <ListGroup title="App">
          <ListRow title="Version" value={`${version}${build !== null ? ` (build ${build})` : ''}`} icon={icon('info.circle', 'info')} tone="teal" />
          {Platform.OS === 'android' ? (
            <ListRow
              title="Check for updates"
              subtitle={
                updateState === 'checking'
                  ? 'Checking…'
                  : updateState === 'none'
                    ? "You're on the latest version"
                    : updateState === 'error'
                      ? "Couldn't check right now"
                      : undefined
              }
              icon={icon('arrow.down.circle', 'system_update')}
              tone="teal"
              onPress={checkUpdates}
            />
          ) : Platform.OS === 'ios' ? (
            <ListRow title="Updates" value="Via SideStore" icon={icon('arrow.down.circle', 'system_update')} tone="teal" />
          ) : null}
          <ListRow
            title={signingOut ? 'Signing out…' : 'Sign out'}
            icon={icon('rectangle.portrait.and.arrow.right', 'logout')}
            tone="danger"
            destructive
            onPress={signingOut ? undefined : confirmSignOut}
          />
        </ListGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 24, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, borderWidth: 1 },
  block: { gap: 10, paddingVertical: 14, paddingHorizontal: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
