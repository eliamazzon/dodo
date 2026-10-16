// Git identity of this build, inlined by Vite's `define` at build time (see vite.config.ts).
// DODO installs unpacked from a git checkout, so "which version am I running" is a commit SHA,
// not the hand-maintained manifest version — that's what the update checker compares against
// origin, and it's what makes the update loop self-verifying: rebuild, reload, SHAs match, banner gone.

export type BuildStamp = {
  sha: string;       // HEAD at build time; '' when git wasn't available (updater stays disabled)
  slug: string;      // "owner/repo" for api.github.com
  branch: string;    // branch to compare against, normally "main"
  repoPath: string;  // absolute path of the checkout — the panel pastes this into the update command
};

declare const __DODO_BUILD__: BuildStamp;

export const BUILD: BuildStamp = __DODO_BUILD__;

export const shortSha = (sha: string) => sha.slice(0, 7);
