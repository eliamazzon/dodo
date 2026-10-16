import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = __dirname;

// Build-time git identity, inlined into every bundle as __DODO_BUILD__ (see src/shared/build.ts).
// The update checker asks GitHub what's on `branch` since `sha`; the panel pastes `repoPath` into
// the copy-able update command. Everything here is best-effort: without git (a tarball download,
// a stripped checkout) `sha` comes back empty and the updater disables itself rather than guessing.
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

// git@github.com:owner/repo.git and https://github.com/owner/repo.git both reduce to "owner/repo".
function slugFromRemote(url: string): string {
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] : '';
}

const branch = git('rev-parse --abbrev-ref HEAD');
const buildStamp = {
  sha: git('rev-parse HEAD'),
  slug: slugFromRemote(git('remote get-url origin')) || 'eliamazzon/dodo',
  // A detached HEAD reports "HEAD", which is not a ref the compare API can resolve.
  branch: !branch || branch === 'HEAD' ? 'main' : branch,
  repoPath: root,
};

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
  define: {
    __DODO_BUILD__: JSON.stringify(buildStamp),
  },
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
