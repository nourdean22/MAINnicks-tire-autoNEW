const fs = require('fs');
let p='server/__tests__/smsNickGPTStress.test.ts';
let c=fs.readFileSync(p,'utf8');
c=c.replace(/\\`/g, '`').replace(/\\\${/g, '${');
fs.writeFileSync(p,c);
