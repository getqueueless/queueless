import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Chip, SectionHeader, UIText } from '@/components/ui';
import { useElderlyMode } from '@/hooks/use-elderly-mode';
import { useTheme } from '@/hooks/use-theme';
import { ThemeToggle } from '@/components/ThemeToggle';
import { setElderlyMode } from '@/lib/elderly-mode-preference';
import { mapAuthError } from '@/lib/errors';
import {
  getLanguagePreference,
  LANGUAGE_LABELS,
  setLanguagePreference,
  type LanguagePreference,
} from '@/lib/language-preference';
import { showToast } from '@/lib/toast-store';
import { supabase } from '@/lib/supabase';
import { unregisterPushTokenAsync } from '@/lib/notifications';
import { useSession } from '@/lib/use-session';

const LANGUAGE_OPTIONS: LanguagePreference[] = ['en', 'hi', 'pa'];

type ProfileRow = { full_name: string | null; phone: string | null; city: string | null };

export default function Profile() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user?.id;

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [languagePref, setLanguagePref] = useState(getLanguagePreference);
  const elderlyMode = useElderlyMode();
  const [signingOut, setSigningOut] = useState(false);

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

  function handleLanguagePress(pref: LanguagePreference) {
    setLanguagePreference(pref);
    setLanguagePref(pref);
    supabase.rpc('set_my_language', { p_language: pref }).then(({ error }) => {
      if (error) console.log('[profile] set_my_language failed (non-fatal):', error);
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    // Before signOut: once signed out, RLS can't see the row and the delete would match 0 rows.
    await unregisterPushTokenAsync();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      setSigningOut(false);
      showToast(mapAuthError({ code: error.code, message: error.message }), 'error');
    }
    // No manual redirect on success -- (app)/_layout.tsx watches the session and redirects once
    // it goes null.
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.canvas }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <SectionHeader title="Profile" />

        <Card onPress={() => router.push('/(app)/name-entry')} accessibilityLabel="Edit your profile">
          <View style={styles.profileRow}>
            <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
              <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={26} tintColor={theme.primaryText} />
            </View>
            <View style={styles.flex}>
              <UIText variant="bodyStrong" numberOfLines={1}>
                {profile?.full_name ?? 'Your profile'}
              </UIText>
              <UIText variant="secondary" numberOfLines={1}>
                {[profile?.phone, profile?.city].filter(Boolean).join(' · ') || 'Tap to complete your details'}
              </UIText>
            </View>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={18}
              tintColor={theme.inkMuted}
            />
          </View>
        </Card>

        <SectionHeader title="Language" />
        <Card style={styles.chipRow}>
          {LANGUAGE_OPTIONS.map((option) => (
            <Chip key={option} label={LANGUAGE_LABELS[option]} selected={languagePref === option} onPress={() => handleLanguagePress(option)} />
          ))}
        </Card>

        <SectionHeader title="Appearance" />
        <Card style={styles.rowCard}>
          <UIText variant="body" style={styles.flex}>
            Theme
          </UIText>
          <ThemeToggle />
        </Card>

        {/* Not a pressable Card: Card's own contract warns a nested control (the Switch) would
            hide from screen readers behind the card's own button role. The Switch keeps its own
            48pt+ tap target and accessibilityLabel instead. */}
        <Card style={styles.rowCard}>
          <View style={styles.flex}>
            <UIText variant="body">Elderly mode</UIText>
            <UIText variant="secondary">Larger text across the app (1.3×)</UIText>
          </View>
          <Switch
            value={elderlyMode}
            onValueChange={setElderlyMode}
            trackColor={{ true: theme.primary }}
            accessibilityLabel="Elderly mode"
          />
        </Card>

        <Button label="Sign out" variant="danger" onPress={handleSignOut} loading={signingOut} block style={styles.signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  flex: { flex: 1 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  signOut: { marginTop: 12 },
});
