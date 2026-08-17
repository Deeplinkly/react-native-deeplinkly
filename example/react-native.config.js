const path = require('path');
const pkg = require('../package.json');

/**
 * Point autolinking at the repo root rather than at the copy in
 * example/node_modules, so the Gradle build and `pod install` compile the
 * sources being edited.
 */
module.exports = {
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..'),
    },
  },
};
