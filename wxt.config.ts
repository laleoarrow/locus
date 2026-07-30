import { defineConfig } from 'wxt';

// Chrome and Edge builds come from this same config (`wxt build -b chrome|edge`).
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: 'Locus / 文迹',
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
