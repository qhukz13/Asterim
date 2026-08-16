import fs from 'fs';

const target =
  '/home/qhukz/Documents/Projects/Asterim/apps/server/src/services/skills/SkillFrontmatter.ts';
const source = fs.readFileSync(target, 'utf8');
const bom = String.fromCharCode(0xfeff);

if (!source.includes(bom)) {
  console.log('no literal BOM present');
} else {
  fs.writeFileSync(target, source.split(bom).join('\\uFEFF'));
  console.log('replaced literal BOM with an escape');
}
