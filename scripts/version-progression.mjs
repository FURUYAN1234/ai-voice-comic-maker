export function checkVersionProgression(localVersion, remoteVersion, localCommit, remoteCommit) {
  const pattern = /^\d+\.[0-9]\.[0-9]$/;
  if (!pattern.test(localVersion) || !pattern.test(remoteVersion)) {
    throw new Error('Release versions must use major.minor.patch with single-digit minor and patch.');
  }
  if (localVersion === remoteVersion) {
    if (localCommit && localCommit === remoteCommit) return;
    throw new Error('Changed source must not reuse the published version.');
  }
  const [major, minor, patch] = remoteVersion.split('.').map(Number);
  const next = patch < 9 ? `${major}.${minor}.${patch + 1}`
    : minor < 9 ? `${major}.${minor + 1}.0` : `${major + 1}.0.0`;
  if (localVersion !== next) throw new Error(`Expected next version ${next}, got ${localVersion}.`);
}
