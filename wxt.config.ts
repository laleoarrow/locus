import { defineConfig } from 'wxt';

// Chrome and Edge builds come from this same config (`wxt build -b chrome|edge`).
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: 'Locus / 文迹',
    // Pins the extension ID (derived from this public key) so it no longer
    // depends on the unpacked folder path. Without it, loading a freshly
    // downloaded build from a different directory yields a new ID — and the
    // annotations in the old ID's IndexedDB become unreachable.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzNUayPu1HXpuU+fEZ9n2KpnRtR5C711fumKtjUT2sp/HCvG0NZ4h41uBA+f9oeVXeRRvJmZPyq/N567A3RP4VYmizKJXclRbYNqkXubaItqSYK8f/7mCRJ+qzPZbfuJCBpwsZh5Bzwe7SU4yVbBDGqIf2sBxY7X6ES/kdej5/G8RNTlEcVoweLl0inUh5vFDQPGgzCmlT/8EU3Xoh6ZQeyi93Lx9NUyh+J/tSX5URx9vGBnvJgCUUJDOMCVzFmUUH2k4HdrJws+ardLyhejLCEYk+r+NvvU9NWi8pX/hkuh6adktDEgrBXhFFsrGz1oUW60gu/lusfnjjUSzH39+/QIDAQAB',
    description: 'A minimal, local-first annotation layer for academic reading.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    permissions: ['storage', 'sidePanel', 'scripting', 'tabs', 'alarms'],
    // Product decision (v0.3): Locus is on everywhere by default, with a
    // per-site off list in prefs. Content scripts are still registered
    // dynamically from granted origins at startup.
    host_permissions: ['http://*/*', 'https://*/*'],
  },
});
