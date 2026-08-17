const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

/**
 * The library is consumed from the repo root, so Metro has to watch it — and
 * must be stopped from resolving the root's own copies of react / react-native.
 * Two React instances in one bundle is the classic invalid-hook-call crash.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: [
      new RegExp(`${path.join(root, 'node_modules', 'react')}/.*`),
      new RegExp(`${path.join(root, 'node_modules', 'react-native')}/.*`),
      // Built output would otherwise shadow src/ and serve stale code.
      new RegExp(`${path.join(root, 'lib')}/.*`),
    ],
    extraNodeModules: {
      // The library is resolved from the repo root rather than installed into
      // example/node_modules. A `file:..` dependency would symlink
      // example/node_modules/react-native-deeplinkly -> the repo root, and the
      // repo root contains example/ — so any recursive directory walk cycles
      // forever. React Native's codegen script does exactly such a walk and
      // spins at 100% CPU indefinitely. Autolinking gets the native side from
      // react-native.config.js instead.
      'react-native-deeplinkly': root,
      react: path.join(__dirname, 'node_modules', 'react'),
      'react-native': path.join(__dirname, 'node_modules', 'react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
