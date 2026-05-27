#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [,, newVersion, changesJa, changesEn] = process.argv;

if (!newVersion || !changesJa || !changesEn) {
  console.error('❌ Error: Missing arguments.');
  console.log('Usage: node scripts/update_version.cjs <new_version> <changes_ja> <changes_en>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-\w+)?$/.test(newVersion)) {
  console.error('❌ Error: Invalid version format. Must be x.y.z or x.y.z-alpha');
  process.exit(1);
}

// 1.5. バージョン進行規則の強制バリデーション (パッチが9の次はマイナー繰り上げ)
const packageJsonPath = path.join(__dirname, '../package.json');
if (fs.existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVer = pkg.version;
    const currentParts = currentVer.split('-')[0].split('.').map(Number);
    const newParts = newVersion.split('-')[0].split('.').map(Number);

    if (currentParts[2] === 9) {
      const expectedMinor = currentParts[1] + 1;
      if (newParts[1] !== expectedMinor || newParts[2] !== 0) {
        console.error(`\n❌ Error: Invalid version progression!`);
        console.error(`   Current version is v${currentVer}.`);
        console.error(`   According to project rules, when the patch version is '9',`);
        console.error(`   the next version must increment the minor version and reset patch to '0'.`);
        console.error(`   (Expected next version: ${currentParts[0]}.${expectedMinor}.0, got: ${newVersion})`);
        console.error(`   Version progression to ${newVersion} is STRICTLY FORBIDDEN.\n`);
        process.exit(1);
      }
    }
  } catch (err) {
    console.warn('⚠️ Warning: Failed to parse package.json for version check:', err.message);
  }
}

console.log(`\n========================================`);
console.log(`  Updating Environment to v${newVersion}`);
console.log(`========================================`);

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

function sanitizeMarkdownBold(text) {
  if (!text) return text;
  let t = text.replace(/\*\*([^*]+)\*\*/g, ' **$1** ');
  t = t.replace(/[ ]+/g, ' ');
  t = t.replace(/^- \*\*/g, '- **');
  return t.trim();
}

const cleanJa = sanitizeMarkdownBold(changesJa);
const cleanEn = sanitizeMarkdownBold(changesEn);

const entryJa = `- **[Fix & UX]** ${cleanJa} / ${cleanEn}`;

const targetFiles = {
  packageJson: path.join(__dirname, '../package.json'),
  appJsx: path.join(__dirname, '../src/App.jsx'),
  indexHtml: path.join(__dirname, '../index.html'),
  readmeMd: path.join(__dirname, '../README.md')
};

for (const [key, filePath] of Object.entries(targetFiles)) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: File not found: ${filePath}`);
    process.exit(1);
  }
}

try {
  // 1. package.json
  console.log(`[1/4] Updating package.json...`);
  const pkgContent = fs.readFileSync(targetFiles.packageJson, 'utf8');
  const updatedPkg = pkgContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
  fs.writeFileSync(targetFiles.packageJson, updatedPkg, 'utf8');

  // 2. src/App.jsx
  console.log(`[2/4] Updating App.jsx...`);
  const appContent = fs.readFileSync(targetFiles.appJsx, 'utf8');
  const updatedApp = appContent.replace(
    /const SYSTEM_VERSION = '[^']+'/,
    `const SYSTEM_VERSION = '${newVersion}'`
  ).replace(
    /const SYSTEM_VERSION = "[^"]+"/,
    `const SYSTEM_VERSION = "${newVersion}"`
  );
  fs.writeFileSync(targetFiles.appJsx, updatedApp, 'utf8');

  // 3. index.html
  console.log(`[3/4] Updating index.html...`);
  const htmlContent = fs.readFileSync(targetFiles.indexHtml, 'utf8');
  const updatedHtml = htmlContent.replace(
    /<title>AI Voice Comic Maker v[^<]+<\/title>/,
    `<title>AI Voice Comic Maker v${newVersion}</title>`
  );
  fs.writeFileSync(targetFiles.indexHtml, updatedHtml, 'utf8');

  // 4. README.md
  console.log(`[4/4] Updating README.md...`);
  let readmeContent = fs.readFileSync(targetFiles.readmeMd, 'utf8');
  readmeContent = readmeContent.replace(
    /version-\d+\.\d+\.\d+(-alpha)?-blue\.svg/,
    `version-${newVersion}-blue.svg`
  ).replace(
    /v\d+\.\d+\.\d+(-alpha)? — AI-driven/,
    `v${newVersion} — AI-driven`
  );

  const changelogHeader = '## 📋 ChangeLog';
  const changelogInsertPos = readmeContent.indexOf(changelogHeader);
  if (changelogInsertPos !== -1) {
    const insertIndex = changelogInsertPos + changelogHeader.length;
    const newChangelogEntry = `\n\n**v${newVersion} (${today})**\n${entryJa}`;
    readmeContent = readmeContent.slice(0, insertIndex) + newChangelogEntry + readmeContent.slice(insertIndex);
  }
  fs.writeFileSync(targetFiles.readmeMd, readmeContent, 'utf8');

  console.log(`\n✅ Success: All files successfully synchronized and updated!`);
} catch (err) {
  console.error(`❌ Error during update process:`, err.message);
  process.exit(1);
}
