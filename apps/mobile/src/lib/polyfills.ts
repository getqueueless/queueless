// React Native swaps in the `abort-controller` package for AbortController/AbortSignal (see
// react-native/Libraries/Core/setUpXHR.js), and that polyfill has no AbortSignal.timeout. Every
// `fetch(url, { signal: AbortSignal.timeout(ms) })` therefore threw a TypeError before the
// request started, on iOS and Android alike (no ETA, no update check, no Ask your data). One
// shim here, imported first by the root layout, fixes every caller.
type TimeoutCapable = typeof AbortSignal & { timeout?: (ms: number) => AbortSignal };

const Signal = globalThis.AbortSignal as TimeoutCapable | undefined;

if (Signal && typeof Signal.timeout !== 'function') {
  Signal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

export {};
