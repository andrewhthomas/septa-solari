// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare(),
  // Emit /49th-baltimore.html rather than /49th-baltimore/index.html so the
  // URL serves without a trailing-slash redirect on Workers static assets.
  build: { format: 'file' },
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()]
  }
});