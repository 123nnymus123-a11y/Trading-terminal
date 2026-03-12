const { run } = require('electron-builder');

const isWin32 = process.platform === 'win32';
const builderCommand = isWin32 ? 'electron-builder.cmd' : 'electron-builder';

run(builderCommand, ...process.argv);
