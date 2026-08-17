const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

/**
 * The library is consumed from the repo root, so Metro has to watch it — and
 * must be stopped from resolving the root's own copies of react / react-native.
 * Two React instances in one bundle is the classic invalid-hook-call crash.
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
      react: path.join(__dirname, 'node_modules', 'react'),
      'react-native': path.join(__dirname, 'node_modules', 'react-native'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
