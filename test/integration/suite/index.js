const path = require('node:path');
const Mocha = require('mocha');

exports.run = async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120000 });
  mocha.addFile(path.resolve(__dirname, 'sqlient.test.js'));

  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
};
