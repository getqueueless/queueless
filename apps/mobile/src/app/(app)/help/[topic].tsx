import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Card, EmptyState, ListGroup, ListRow, UIText, type IconName, type Tone } from '@/components/ui';

const icon = (ios: string, md: string) => ({ ios, android: md, web: md }) as IconName;

type Point = { title: string; text: string; icon: IconName; tone: Tone };

// Plain-language copy, true to how the system behaves (docs/PAYMENTS.md, the schema's RLS).
const TOPICS: Record<string, { title: string; intro: string; points: Point[]; footer?: string; numbered?: boolean }> = {
  how: {
    title: 'How Queueless works',
    intro: 'Skip standing in the hall. Your place in line lives on your phone.',
    numbered: true,
    points: [
      {
        title: 'Take a token or book a time',
        text: 'Pick a department or a doctor. If the doctor charges a fee, you pay online and your place is held while you pay.',
        icon: icon('ticket', 'confirmation_number'),
        tone: 'teal',
      },
      {
        title: 'Wait wherever you like',
        text: 'The tracker shows how many people are ahead of you and your estimated wait. We alert you when your turn is near.',
        icon: icon('clock', 'schedule'),
        tone: 'orange',
      },
      {
        title: 'Go when you are called',
        text: 'Your phone shows which counter to go to. Show your token number at the desk.',
        icon: icon('bell', 'notifications'),
        tone: 'green',
      },
    ],
    footer: 'Senior citizens and pregnant patients get a head start once staff verify them at the desk.',
  },
  refunds: {
    title: 'Cancellation & refund policy',
    intro: 'Short and simple.',
    points: [
      { title: 'Holds last 10 minutes', text: 'A paid booking holds your place for 10 minutes. If you don’t pay, the hold is released automatically.', icon: icon('timer', 'timer'), tone: 'amber' },
      { title: 'Cancel a waiting token any time', text: 'Open the ticket and tap Cancel. Your place goes to the next patient.', icon: icon('xmark.circle', 'cancel'), tone: 'rose' },
      { title: 'Doctor on leave? Automatic refund', text: 'If your doctor goes on leave for the day of your paid booking, the full fee is refunded automatically.', icon: icon('arrow.uturn.backward.circle', 'currency_exchange'), tone: 'green' },
      { title: 'Other refunds are reviewed', text: 'Any other refund after payment is reviewed and approved by the hospital’s admin.', icon: icon('person.badge.shield.checkmark', 'verified_user'), tone: 'blue' },
      { title: 'Back to where it came from', text: 'Refunds return to the original payment method through Razorpay. You can see the status under Payments & receipts.', icon: icon('creditcard', 'credit_card'), tone: 'teal' },
    ],
  },
  privacy: {
    title: 'Privacy',
    intro: 'What we store and why. Nothing else.',
    points: [
      { title: 'Your details', text: 'Name, phone, date of birth, gender, city and address, so the desk can identify you and staff can verify priority.', icon: icon('person', 'person'), tone: 'teal' },
      { title: 'Your tokens and visits', text: 'Your place in queues, appointments and past visits, to run the queue and show your history.', icon: icon('ticket', 'confirmation_number'), tone: 'orange' },
      { title: 'Payment status, never card details', text: 'We keep the amount and whether it was paid or refunded. Card and UPI details stay with Razorpay.', icon: icon('creditcard', 'credit_card'), tone: 'green' },
      { title: 'A notification token', text: 'Only to send your queue alerts. It is removed when you sign out or turn alerts off.', icon: icon('bell', 'notifications'), tone: 'amber' },
      { title: 'Your app preferences', text: 'Language, theme and text size stay on this phone. Your language is also saved to your account so alerts arrive in it.', icon: icon('gearshape', 'settings'), tone: 'blue' },
    ],
    footer: 'Only you and staff at your hospital can see your records; the database enforces this for every read.',
  },
};

export default function HelpTopic() {
  const { topic } = useLocalSearchParams<{ topic: string }>();
  const page = TOPICS[topic ?? ''];

  if (!page) {
    return (
      <ThemedView type="canvasSoft" style={styles.flex}>
        <EmptyState icon={icon('questionmark.circle', 'help')} title="Page not found" text="This help page doesn't exist." />
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: page.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <UIText variant="title2">{page.title}</UIText>
        <UIText color="inkSecondary">{page.intro}</UIText>
        {page.numbered ? (
          page.points.map((p, i) => (
            <Card key={p.title}>
              <View style={styles.step}>
                <UIText variant="title1" color="primaryDisplay" accessibilityLabel={`Step ${i + 1}`}>
                  {i + 1}
                </UIText>
                <View style={styles.flex}>
                  <UIText variant="bodyStrong">{p.title}</UIText>
                  <UIText variant="secondary">{p.text}</UIText>
                </View>
              </View>
            </Card>
          ))
        ) : (
          <ListGroup>
            {page.points.map((p) => (
              <ListRow key={p.title} title={p.title} subtitle={p.text} icon={p.icon} tone={p.tone} />
            ))}
          </ListGroup>
        )}
        {page.footer ? <UIText variant="secondary">{page.footer}</UIText> : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  step: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
});
