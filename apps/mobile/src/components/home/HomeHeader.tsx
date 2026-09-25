import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AnimatedHeading } from '@/components/AnimatedHeading';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UIText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/use-session';

import { LiveTokenHero } from './LiveTokenHero';

function greeting(hour: number) {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export type HomeHeaderProps = {
  /** Below the greeting. Defaults to the live-token hero; pass null to hide it. */
  hero?: ReactNode;
};

/** Home's top: a time-of-day greeting with the patient's first name, the theme switch, and a hero. */
export function HomeHeader({ hero }: HomeHeaderProps) {
  const { session } = useSession();
  const userId = session?.user?.id;
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const full = (data as { full_name: string | null } | null)?.full_name?.trim();
        if (!cancelled) setFirstName(full ? full.split(/\s+/)[0] : null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <UIText variant="secondary">{greeting(new Date().getHours())}</UIText>
          {/* Keyed on the name so the letters play once it arrives, not on the placeholder. */}
          <AnimatedHeading key={firstName ?? ''} text={firstName ?? 'Welcome'} />
        </View>
        <ThemeToggle />
      </View>
      {hero === undefined ? <LiveTokenHero /> : hero}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
