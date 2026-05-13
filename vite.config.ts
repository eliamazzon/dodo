import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

const root = __dirname;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dodo-copy-manifest',
      apply: 'build',
      closeBundle() {
        const outDir = resolve(root, 'dist');
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        copyFileSync(resolve(root, 'public/manifest.json'), resolve(outDir, 'manifest.json'));
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'src/sidepanel/index.html'),
        onboarding: resolve(root, 'src/onboarding/index.html'),
        background: resolve(root, 'src/background/service-worker.ts'),
        content: resolve(root, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background/service-worker.js';
          if (chunk.name === 'content') return 'content/content.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
});
