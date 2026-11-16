const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  // When this script is started from inside a VS Code extension host these variables
  // make a newly launched VS Code behave like a Node process or attach to the wrong instance.
  for (const key of Object.keys(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'ELECTRON_NO_ATTACH_CONSOLE' || key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }

  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

  const installed =
    process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || installed,
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
