'use strict';

// Same as `duplicate-image-detector eval`; kept for existing instructions.
//   node scripts/eval-folder.js <folder> [options]   (see `duplicate-image-detector help`)

process.argv.splice(2, 0, 'eval');
require('../bin/duplicate-image-detector.js');
