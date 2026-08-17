import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import Deeplinkly, {
  DeeplinklyEvent,
  type DeeplinklyLink,
} from 'react-native-deeplinkly';

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const [log, setLog] = useState<string[]>([]);
  const [links, setLinks] = useState<DeeplinklyLink[]>([]);

  const write = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...prev]);
  }, []);

  useEffect(() => {
    Deeplinkly.setDebugMode(true);

    // Subscribing is what signals readiness to native. Links that resolved
    // before this ran were buffered and arrive now.
    const sub = Deeplinkly.addListener((link) => {
      setLinks((prev) => [link, ...prev]);
      write(`deep link: click_id=${link.click_id} params=${JSON.stringify(link.params)}`);
    });

    Deeplinkly.isAvailable().then((ok) =>
      write(`isAvailable: ${ok}${ok ? '' : ' (no API key — every call returns its failure value)'}`)
    );
    Deeplinkly.getDeeplinklyId().then((id) => write(`deeplinklyId: ${id || '(empty)'}`));
    Deeplinkly.getAttributionLevel().then((l) => write(`attributionLevel: ${l}`));
    Deeplinkly.getInstallAttribution().then((a) =>
      write(`installAttribution: ${JSON.stringify(a)}`)
    );

    return () => sub.remove();
  }, [write]);

  const runLogEvent = useCallback(async () => {
    const ok = await Deeplinkly.logEvent(DeeplinklyEvent.purchase, {
      order_id: 'ord_42',
      amount: 49.99,
      currency: 'INR',
    });
    write(`logEvent(purchase) -> ${ok}`);
  }, [write]);

  const runGenerateLink = useCallback(async () => {
    const result = await Deeplinkly.generateLink(
      {
        canonicalIdentifier: 'product/sku_42',
        title: 'Pro Plan',
        metadata: { screen: 'upgrade', plan: 'pro' },
      },
      { channel: 'example-app', feature: 'smoke_test', tags: ['rn'] }
    );
    write(`generateLink -> ${JSON.stringify(result)}`);
  }, [write]);

  const runIdentity = useCallback(async () => {
    Deeplinkly.setUserId('user_123');
    write('setUserId(user_123)');
    write(`deeplinklyId: ${await Deeplinkly.getDeeplinklyId()}`);
  }, [write]);

  const runPrivacy = useCallback(async () => {
    write(`setAttributionLevel(reduced) -> ${await Deeplinkly.setAttributionLevel('reduced')}`);
    write(`getAttributionLevel -> ${await Deeplinkly.getAttributionLevel()}`);
    write(`setAttributionLevel(full) -> ${await Deeplinkly.setAttributionLevel('full')}`);
  }, [write]);

  const runPasteboard = useCallback(async () => {
    write(`willShowPasteboardBanner -> ${await Deeplinkly.willShowPasteboardBanner()}`);
    write(`checkPasteboardNow -> ${await Deeplinkly.checkPasteboardNow()}`);
  }, [write]);

  const theme = isDark ? styles.dark : styles.light;

  return (
    <SafeAreaView style={[styles.root, theme]}>
      <Text style={[styles.title, theme]}>react-native-deeplinkly</Text>

      <View style={styles.buttons}>
        <Button title="logEvent" onPress={runLogEvent} />
        <Button title="generateLink" onPress={runGenerateLink} />
        <Button title="identity" onPress={runIdentity} />
        <Button title="privacy" onPress={runPrivacy} />
        <Button title="pasteboard" onPress={runPasteboard} />
      </View>

      <Text style={[styles.heading, theme]}>
        Deep links received: {links.length}
      </Text>

      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={[styles.line, theme]} selectable>
            {line}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  light: { backgroundColor: '#fff', color: '#111' },
  dark: { backgroundColor: '#111', color: '#eee' },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  heading: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  log: { flex: 1 },
  line: { fontFamily: 'Menlo', fontSize: 11, marginBottom: 3 },
});
