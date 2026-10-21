import { defineConfig } from '@playwright/test';

// A port nothing else uses, and never reuse an existing server: a stale
// `python3 -m http.server` from another worktree would serve the wrong
// content and make these tests lie.
const PORT = 8123;

export default defineConfig({
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/client/`,
    reuseExistingServer: false,
  },
  testDir: 'tests/client',
  use: {
    baseURL: `http://localhost:${PORT}/client/`,
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'client',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
