import { defineConfig } from 'wxt';

// Chrome and Edge builds come from this same config (`wxt build -b chrome|edge`).
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: ({ mode }) => ({
    name: 'Locus / 文迹',
    description: 'A minimal, local-first annotation layer for academic reading.',
    permissions: ['storage', 'sidePanel', 'scripting', 'tabs'],
    // No host access at install; per-site grants are requested at runtime.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    // The e2e build pre-grants localhost so Playwright can skip the native
    // permission prompt (not automatable) while testing the same
    // registration code path. Never present in production builds.
    ...(mode === 'e2e'
      ? { host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'] }
      : {}),
  }),
});
