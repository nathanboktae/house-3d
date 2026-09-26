const fs = require('fs');
const path = require('path');
const validator = require('gltf-validator');
const input = path.resolve(__dirname, '../output/house.glb');
validator.validateBytes(new Uint8Array(fs.readFileSync(input)), {uri: 'house.glb', maxIssues: 10000}).then(report => {
  fs.writeFileSync(path.join(path.dirname(input), 'gltf-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.issues, null, 2));
  if(report.issues.numErrors) process.exitCode = 1;
});
