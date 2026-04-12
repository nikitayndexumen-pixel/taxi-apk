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
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { WebViewNavigation } from "react-native-webview";
import { Audio } from "expo-av";
import * as Notifications from "expo-notifications";

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

    // Перехватываем браузерные уведомления и пересылаем в приложение
    const _OrigNotification = window.Notification;
    function NativeNotification(title, options) {
      try {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'NOTIFICATION', title: title, body: options && options.body || '' })
        );
      } catch(e) {}
      if (_OrigNotification) {
        try { return new _OrigNotification(title, options); } catch(e) {}
      }
    }
    NativeNotification.requestPermission = function() { return Promise.resolve('granted'); };
    NativeNotification.permission = 'granted';
    Object.defineProperty(NativeNotification, 'permission', { get: function() { return 'granted'; } });
    try { window.Notification = NativeNotification; } catch(e) {}

    // Перехватываем Service Worker push если сайт его использует
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function(e) {
        if (e.data && (e.data.type === 'PUSH' || e.data.title)) {
          try {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'NOTIFICATION', title: e.data.title || 'Taxi Impulse', body: e.data.body || '' })
            );
          } catch(err) {}
        }
      });
    }
  })();
  true;
`;

async function setupAudio() {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
  } catch {}
}

async function playNotificationSound() {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require("../assets/notification.mp3"),
      { shouldPlay: true, volume: 1.0 }
    );
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch (e) {
    console.log("Sound error:", e);
  }
}

async function showLocalNotification(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "notification.mp3",
        vibrate: [0, 250, 250, 250],
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch {}
}

async function requestNotificationPermission() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export default function WebViewScreen() {
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    setupAudio();
    requestNotificationPermission();

    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("taxi-impulse", {
        name: "Taxi Impulse",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "notification.mp3",
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
        showBadge: true,
      }).catch(() => {});
    }

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
    });
    return () => appStateSub.remove();
  }, []);

  const handleMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "NOTIFICATION") {
        const title = msg.title || "Taxi Impulse";
        const body = msg.body || "";
        await playNotificationSound();
        if (appStateRef.current !== "active") {
          await showLocalNotification(title, body);
        }
      }
    } catch {}
  }, []);

  const handleNavChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  const handleBack = useCallback(() => {
    if (canGoBack) {
      webviewRef.current?.goBack();
      return true;
    }
    return false;
  }, [canGoBack]);

  const handleReload = useCallback(() => {
    setError(false);
    setLoading(true);
    webviewRef.current?.reload();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => sub.remove();
  }, [handleBack]);

  const handleShouldStart = useCallback((request: { url: string }) => {
    const url = request.url;
    if (
      url.startsWith("tel:") ||
      url.startsWith("mailto:") ||
      url.startsWith("whatsapp:") ||
      url.startsWith("tg:")
    ) {
      return false;
    }
    return true;
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#08081a" />

      {loading && !error && (
        <View style={styles.loadingOverlay}>
          <View style={styles.logoBox}>
            <Feather name="navigation" size={36} color="#f5c842" />
          </View>
          <Text style={styles.loadingTitle}>TAXI IMPULSE</Text>
          <ActivityIndicator
            size="large"
            color="#7c3aed"
            style={styles.spinner}
          />
          <Text style={styles.loadingHint}>Загрузка...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Feather name="wifi-off" size={52} color="#ffffff30" />
          <Text style={styles.errorTitle}>Нет соединения</Text>
          <Text style={styles.errorText}>
            Проверьте подключение к интернету и попробуйте снова
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleReload}>
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ uri: SITE_URL }}
        style={[styles.webview, error && styles.hidden]}
        injectedJavaScript={INJECTED_JS}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onNavigationStateChange={handleNavChange}
        onLoadStart={() => {
          setLoading(true);
          setError(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) {
            setError(true);
            setLoading(false);
          }
        }}
        onShouldStartLoadWithRequest={handleShouldStart}
        onMessage={handleMessage}
        userAgent={`TaxiImpulseApp/1.0 (${Platform.OS})`}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        originWhitelist={["https://taxiimpulse.ru", "https://*.taxiimpulse.ru", "*"]}
        onContentProcessDidTerminate={() => webviewRef.current?.reload()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#08081a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#08081a",
  },
  hidden: {
    opacity: 0,
    flex: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#08081a",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#1a1a3a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#ffffff10",
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 2,
    marginBottom: 32,
  },
  spinner: {
    marginBottom: 12,
  },
  loadingHint: {
    fontSize: 13,
    color: "#ffffff40",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    color: "#ffffff50",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#7c3aed",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
  },
});
