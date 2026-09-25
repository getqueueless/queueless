const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker imports a .wasm file directly -- Metro's default asset extensions
// don't include wasm, so it tries (and fails) to resolve it as a source module. Needed for
// `expo start --web` to bundle at all; apps/mobile/src/lib/supabase.ts imports
// expo-sqlite/localStorage/install on every platform including web.
config.resolver.assetExts.push('wasm');

module.exports = config;
