import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log("🛡️ [Security Check] Validating Git Environment...");

try {
    const gitDir = path.join(process.cwd(), '.git');
    if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
        console.error("❌ [CRITICAL] Git is in a MERGING state!");
        process.exit(1);
    }

    console.log("🔄 [Sync] Checking remote status...");
    execSync('git fetch origin master');

    console.log("🔢 [Version Sync] Checking version consistency across files...");

    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const pkgVersion = packageJson.version; // "x.y.z"

    // Check version progression (patch = 9 -> minor increment check)
    try {
        const remotePkgRaw = execSync('git show origin/master:package.json').toString();
        const remotePkg = JSON.parse(remotePkgRaw);
        const remoteVer = remotePkg.version;
        const remoteParts = remoteVer.split('-')[0].split('.').map(Number);
        const localParts = pkgVersion.split('-')[0].split('.').map(Number);

        if (remoteParts[2] === 9) {
            const expectedMinor = remoteParts[1] + 1;
            if (localParts[1] !== expectedMinor || localParts[2] !== 0) {
                console.error(`❌ [Version Progression] RULE VIOLATION: Remote version is v${remoteVer}.`);
                console.error(`   According to project rules, when the patch version is '9',`);
                console.error(`   the next version must increment the minor version and reset patch to '0'.`);
                console.error(`   (Expected next version: ${remoteParts[0]}.${expectedMinor}.0, got: ${pkgVersion})`);
                process.exit(1);
            }
        }
    } catch (e) {
        console.warn("⚠️ [Version Progression] Warning: Could not verify version progression with origin/master: " + e.message);
    }

    const appVersionMatch = fs.readFileSync('src/App.jsx', 'utf-8').match(/const SYSTEM_VERSION = ['"]([^'"]+)['"]/);
    const appVersion = appVersionMatch ? appVersionMatch[1] : null;

    const htmlVersionMatch = fs.readFileSync('index.html', 'utf-8').match(/<title>AI Voice Comic Maker v([^<]+)<\/title>/);
    const htmlVersion = htmlVersionMatch ? htmlVersionMatch[1] : null;

    let versionErrors = 0;
    if (appVersion !== pkgVersion) {
        console.error(`❌ [Version] MISMATCH: package.json="${pkgVersion}" but App.jsx="${appVersion}"`);
        versionErrors++;
    }
    if (htmlVersion !== pkgVersion) {
        console.error(`❌ [Version] MISMATCH: package.json="${pkgVersion}" but index.html="${htmlVersion}"`);
        versionErrors++;
    }

    if (versionErrors > 0) {
        console.error(`❌ [Version Sync] ${versionErrors} version mismatch(es) detected. Fix before deploying!`);
        process.exit(1);
    }
    console.log(`✅ [Version Sync] All files consistent: v${pkgVersion}`);

    console.log("🧪 [Runtime Integrity] Checking that AI analysis fails closed without an API key...");
    const serverSource = fs.readFileSync('server.js', 'utf-8');
    const forbiddenMockMarkers = [
        'input/sample/metadata.json',
        'mockPath',
        'モックデータ',
    ];
    const presentMockMarkers = forbiddenMockMarkers.filter(marker => serverSource.includes(marker));
    if (presentMockMarkers.length > 0) {
        console.error(`❌ [Runtime Integrity] Mock analysis fallback remains in server.js: ${presentMockMarkers.join(', ')}`);
        process.exit(1);
    }
    console.log("✅ [Runtime Integrity] No mock analysis fallback is present.");

    console.log("🎉 [Pre-Deploy] All checks passed!");
} catch (error) {
    console.error("❌ [ERROR] Pre-deploy check failed:", error.message);
    process.exit(1);
}
