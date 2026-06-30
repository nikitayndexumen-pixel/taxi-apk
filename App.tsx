import { useRef, useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Platform,
  BackHandler,
  StatusBar,
  AppState,
  PermissionsAndroid,
} from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as Notifications from "expo-notifications";
import { usePipMode, PipHandler } from "react-native-pip-mode";
import type { WebViewNavigation } from "react-native-webview";

const SITE_URL = "https://taxiimpulse.ru";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const INJECTED_JS = `
  (function() {
    window.__TAXI_NATIVE_APP__ = true;
    window.__TAXI_APP_PLATFORM__ = '${Platform.OS}';
    document.documentElement.setAttribute('data-native-app', 'true');
    var NativeNotification = function(title, options) {
      try {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'NOTIFICATION', title: title, body: (options && options.body) || '' })
        );
      } catch(e) {}
    };
    NativeNotification.requestPermission = function() { return Promise.resolve('granted'); };
    NativeNotification.permission = 'granted';
    try { window.Notification = NativeNotification; } catch(e) {}
  })();
  true;
`;

async function requestLocationPermission() {
  if (Platform.OS !== "android") return;
  try {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
  } catch {}
}

async function playNotificationSound() {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(
      require("./assets/notification.mp3"),
      { shouldPlay: true, volume: 1.0 }
    );
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {});
    });
  } catch {}
}

function ordersWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "заказ";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "заказа";
  return "заказов";
}

function PipBubble({ count }: { count: number }) {
  return (
    <View style={styles.pipContainer}>
      <Text style={styles.pipEmoji}>🚕</Text>
      {count > 0 ? (
        <>
          <Text style={styles.pipCount}>{count}</Text>
          <Text style={styles.pipLabel}>{ordersWord(count)}</Text>
        </>
      ) : (
        <Text style={styles.pipLabel}>ожидание</Text>
      )}
    </View>
  );
}

function WebViewScreen() {
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const driverBubbleActiveRef = useRef(false);
  const [bubbleCount, setBubbleCount] = useState(0);

  // PiP mode state (true when app is in PiP window)
  const isPip = usePipMode();

  useEffect(() => {
    Notifications.requestPermissionsAsync().catch(() => {});
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("taxi-impulse", {
        name: "Taxi Impulse",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "notification.mp3",
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
      }).catch(() => {});
    }
    requestLocationPermission();

    const sub = AppState.addEventListener("change", (nextState) => {
      // When app goes to background while driver bubble is active → enter PiP mode
      if (
        appStateRef.current === "active" &&
        (nextState === "background" || nextState === "inactive") &&
        driverBubbleActiveRef.current
      ) {
        try {
          PipHandler.enterPipMode(200, 300);
        } catch {}
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  const handleMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      if (msg.type === "NOTIFICATION") {
        await playNotificationSound();
        if (appStateRef.current !== "active") {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: msg.title || "Taxi Impulse",
              body: msg.body || "",
              sound: "notification.mp3",
            },
            trigger: null,
          });
        }
        return;
      }

      if (msg.type === "DRIVER_BUBBLE_ACTIVE") {
        driverBubbleActiveRef.current = true;
        setBubbleCount(msg.count ?? 0);
        return;
      }

      if (msg.type === "DRIVER_BUBBLE_UPDATE") {
        const c = msg.count ?? 0;
        setBubbleCount(c);
        return;
      }

      if (msg.type === "DRIVER_BUBBLE_HIDE") {
        driverBubbleActiveRef.current = false;
        setBubbleCount(0);
        return;
      }
    } catch {}
  }, []);

  const handleBack = useCallback(() => {
    if (canGoBack) { webviewRef.current?.goBack(); return true; }
    return false;
  }, [canGoBack]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => sub.remove();
  }, [handleBack]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#19063e" />

      {/* PiP overlay — shown when in mini-window mode */}
      {isPip && <PipBubble count={bubbleCount} />}

      {/* Normal UI */}
      {!isPip && loading && !error && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingTitle}>TAXI IMPULSE</Text>
          <ActivityIndicator size="large" color="#7c3aed" style={{ marginTop: 24 }} />
          <Text style={styles.loadingHint}>Загрузка...</Text>
        </View>
      )}

      {!isPip && error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Нет соединения</Text>
          <Text style={styles.errorText}>Проверьте подключение к интернету</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setError(false); setLoading(true); hasLoadedRef.current = false; webviewRef.current?.reload(); }}
          >
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ uri: SITE_URL }}
        style={[styles.webview, (isPip || error) && styles.hidden]}
        injectedJavaScript={INJECTED_JS}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onNavigationStateChange={(nav: WebViewNavigation) => setCanGoBack(nav.canGoBack)}
        onLoadStart={() => {
          if (hasLoadedRef.current) return;
          setLoading(true);
          setError(false);
          if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = setTimeout(() => setLoading(false), 8000);
        }}
        onLoadEnd={() => {
          if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
          hasLoadedRef.current = true;
          setLoading(false);
        }}
        onError={() => { setLoading(false); setError(!hasLoadedRef.current); }}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500 && !hasLoadedRef.current) {
            setError(true); setLoading(false);
          }
        }}
        onMessage={handleMessage}
        userAgent={`TaxiImpulseApp/1.0 (${Platform.OS})`}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        originWhitelist={["*"]}
        onContentProcessDidTerminate={() => webviewRef.current?.reload()}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <WebViewScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#19063e" },
  webview: { flex: 1, backgroundColor: "#08081a" },
  hidden: { opacity: 0, flex: 0, height: 0 },

  pipContainer: {
    flex: 1,
    backgroundColor: "#19063e",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  pipEmoji: { fontSize: 36 },
  pipCount: {
    fontSize: 40,
    fontWeight: "800",
    color: "#fff",
    lineHeight: 44,
  },
  pipLabel: { fontSize: 14, color: "#ffffff99", fontWeight: "500" },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#19063e",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  loadingTitle: { fontSize: 24, fontWeight: "700", color: "#fff", letterSpacing: 3 },
  loadingHint: { fontSize: 13, color: "#ffffff50", marginTop: 12 },

  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  errorTitle: { fontSize: 20, fontWeight: "700", color: "#fff" },
  errorText: { fontSize: 14, color: "#ffffff50", textAlign: "center" },
  retryBtn: { marginTop: 12, backgroundColor: "#7c3aed", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
