import { defineConfig, type Plugin } from 'vite';

// Im Build verbietet eine CSP alle fremden Ursprünge: keine CDNs, Webfonts oder Tracker.
const csp: Plugin = {
  name: 'twin-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  base: './',
  plugins: [csp],
  // three.js allein macht ~600 KB aus; Aufteilen lohnt sich erst mit Teil B.
  build: { target: 'es2022', reportCompressedSize: true, chunkSizeWarningLimit: 700 },
  test: { include: ['src/**/*.test.ts'] },
});
