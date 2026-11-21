import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  manifest: {
    name: 'Force Dark',
    description: 'Force a dark theme on the website you are viewing',
    permissions: ['storage', 'scripting', 'tabs'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Force Dark',
    },
    commands: {
      'toggle-site': {
        suggested_key: { default: 'Alt+Shift+D' },
        description: 'Toggle forced dark for the current site',
      },
    },
  },
});
