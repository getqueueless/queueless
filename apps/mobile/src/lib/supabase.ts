import "react-native-url-polyfill/auto";
import "./storage-polyfill";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      // Web leaves storage unset: supabase-js uses window.localStorage in the browser and
      // memory while static rendering in Node, where there is no localStorage global.
      ...(Platform.OS === "web" ? {} : { storage: localStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE, not the implicit flow -- required for Google sign-in (lib/google-auth.ts) to
      // exchange the code GoTrue hands back over `queueless://auth/callback` for a session.
      // Doesn't affect email OTP, which never goes through this exchange path.
      flowType: "pkce",
    },
  },
);
