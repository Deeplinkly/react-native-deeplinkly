#!/usr/bin/env node
/**
 * Fails if the published tarball would contain anything it should not.
 *
 * `files` in package.json is an allowlist, which is the right default — but it
 * allows whole directories (`android`, `ios`), and those accumulate build output,
 * local config and secrets over time. `android/build` alone was once 144 of the
 * 189 shipped files. An allowlist cannot notice that; this can.
 *
 * Run it in CI and before publishing. It shells out to `npm pack --dry-run`
 * rather than reimplementing npm's ignore rules, so it audits exactly what npm
 * would upload.
 */

'use strict';

const { execFileSync } = require('node:child_process');

/**
 * Patterns that must never ship, with the reason shown on failure.
 *
 * Ordered roughly by how much it would matter. Secrets first: a published
 * tarball is public and immutable, so a key in one is a key to rotate.
 */
const FORBIDDEN = [
  [/(^|\/)deeplinkly\.properties$/, 'API key file'],
  [/(^|\/)local\.properties$/, 'local SDK paths'],
  [/(^|\/)\.env(\..*)?$/, 'environment file'],
  [/(^|\/)Deeplinkly\.local\.plist$/, 'local key plist'],
  // Named individually rather than blocking `docs/` wholesale: that directory
  // holds the public integration reference and signals catalogue too, and the
  // shipped README links to both. Excluding all of it published a README full of
  // dead links.
  [/(^|\/)NATIVE_SDK_MIGRATION\.md$/, 'internal handoff doc'],
  [/(^|\/)PUBLISHING\.md$/, 'internal release runbook'],
  [/^android\/build\//, 'Gradle build output'],
  [/^android\/\.gradle\//, 'Gradle caches'],
  [/^android\/\.cxx\//, 'native build caches'],
  [/^ios\/build\//, 'Xcode build output'],
  [/^ios\/Pods\//, 'CocoaPods checkout'],
  [/(^|\/)example\//, 'the example app'],
  [/(^|\/)__tests__\//, 'tests'],
  [/\.(test|spec)\.[jt]sx?$/, 'tests'],
  [/(^|\/)\.github\//, 'CI config'],
  [/\.(log|keystore|jks|p12|mobileprovision)$/, 'build secret or log'],
  [/(^|\/)\.DS_Store$/, 'macOS cruft'],
];

/** Hard ceiling, as a blunt catch-all for whatever the patterns miss. */
const MAX_FILES = 60;

function packFileList() {
  // --ignore-scripts so the `prepare` hook (bob build) does not interleave its
  // progress output with the JSON payload. This audits file *names*, so it does
  // not need a fresh build — but run it after one, since `lib/` has to exist to
  // be checked at all.
  const raw = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );

  // npm pretty-prints, so the array opens as `[\n  {`. Any hook that slipped
  // through would print before it, and the payload has nested arrays of its own,
  // so try each candidate start and keep the first that parses whole.
  for (const match of raw.matchAll(/\[\s*\{/g)) {
    try {
      const parsed = JSON.parse(raw.slice(match.index));
      if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].files)) {
        return parsed[0].files.map((f) => f.path);
      }
    } catch {
      // Not the outermost array; keep looking.
    }
  }

  throw new Error(
    'could not parse `npm pack --dry-run --json` output:\n' + raw.slice(0, 400)
  );
}

function main() {
  const files = packFileList();
  const problems = [];

  for (const file of files) {
    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(file)) {
        problems.push(`  ${file}  — ${reason}`);
        break;
      }
    }
  }

  if (files.length > MAX_FILES) {
    problems.push(
      `  ${files.length} files in the tarball, over the ${MAX_FILES} ceiling — ` +
        'something is being included wholesale'
    );
  }

  if (problems.length > 0) {
    console.error(
      `\npack-audit: ${problems.length} problem(s) in the publishable tarball:\n`
    );
    console.error(problems.join('\n'));
    console.error(
      '\nFix the `files` array in package.json, then re-run `npm run pack:audit`.\n'
    );
    process.exit(1);
  }

  console.log(`pack-audit: ${files.length} files, nothing forbidden.`);
}

main();
