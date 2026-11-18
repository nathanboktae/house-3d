const fs = require('fs');
const path = require('path');
const validator = require('gltf-validator');
const clean = process.argv.includes('--clean');
const filename = clean ? 'house-clean.glb' : 'house.glb';
const input = path.resolve(__dirname, '../output', filename);
validator.validateBytes(new Uint8Array(fs.readFileSync(input)), {uri: filename, maxIssues: 10000}).then(report => {
  fs.writeFileSync(path.join(path.dirname(input), clean ? 'clean-gltf-validation.json' : 'gltf-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.issues, null, 2));
  if(report.issues.numErrors) process.exitCode = 1;
});
