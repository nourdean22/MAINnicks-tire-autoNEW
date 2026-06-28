const fs = require('fs');

function fixFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  // Remove backslash before backtick
  content = content.replace(/\\`/g, '`');
  // Remove backslash before dollar sign brace
  content = content.replace(/\\\${/g, '${');
  fs.writeFileSync(path, content);
  console.log(`Fixed ${path}`);
}

fixFile('server/services/carouselStudio/carouselRender.ts');
fixFile('server/services/metaSocial.ts');
