import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Force Dark',
    description: 'Toggle a forced dark theme for the current website',
    permissions: ['storage', 'scripting', 'tabs'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Force Dark',
    },
  },
});
