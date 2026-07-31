import { defineConfig } from 'wxt';

const isStoreBuild = process.env.LOCUS_STORE_BUILD === '1';

// Chrome and Edge builds come from this same config (`wxt build -b chrome|edge`).
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  outDirTemplate: isStoreBuild
    ? '{{browser}}-mv{{manifestVersion}}-store'
    : '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  zip: {
    artifactTemplate: isStoreBuild
      ? '{{name}}-{{packageVersion}}-{{browser}}-store.zip'
      : '{{name}}-{{packageVersion}}-{{browser}}{{modeSuffix}}.zip',
  },
  manifest: ({ mode }) => {
    if (mode === 'store') {
      throw new Error('Do not use --mode store; run pnpm zip:store or pnpm zip:store:edge.');
    }
    if (isStoreBuild && (mode !== 'production' || process.env.NODE_ENV !== 'production')) {
      throw new Error('Store builds must run with WXT mode and NODE_ENV set to production.');
    }
    return {
      name: 'Locus / 文迹',
      // Pins the extension ID (derived from this public key) so it no longer
      // depends on the unpacked folder path. Without it, loading a freshly
      // downloaded build from a different directory yields a new ID — and the
      // annotations in the old ID's IndexedDB become unreachable.
      //
      // Two builds deliberately omit it:
      //  - `migrate`: dropped into the folder an older keyless install was
      //    loaded from, it keeps that install's path-derived ID so its
      //    annotations can still be exported (see scripts/migrate-bridge.mjs).
      //  - `LOCUS_STORE_BUILD=1`: the stores assign and manage their own IDs;
      //    the separate flag keeps WXT in production mode.
      ...(mode === 'migrate' || isStoreBuild
        ? {}
        : {
            key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzNUayPu1HXpuU+fEZ9n2KpnRtR5C711fumKtjUT2sp/HCvG0NZ4h41uBA+f9oeVXeRRvJmZPyq/N567A3RP4VYmizKJXclRbYNqkXubaItqSYK8f/7mCRJ+qzPZbfuJCBpwsZh5Bzwe7SU4yVbBDGqIf2sBxY7X6ES/kdej5/G8RNTlEcVoweLl0inUh5vFDQPGgzCmlT/8EU3Xoh6ZQeyi93Lx9NUyh+J/tSX5URx9vGBnvJgCUUJDOMCVzFmUUH2k4HdrJws+ardLyhejLCEYk+r+NvvU9NWi8pX/hkuh6adktDEgrBXhFFsrGz1oUW60gu/lusfnjjUSzH39+/QIDAQAB',
          }),
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
    };
  },
});
