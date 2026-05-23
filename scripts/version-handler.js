/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('child_process');
const fs = require('fs');

const REQUIRED_BRANCH = 'main';
const VERSION_REGEX = /^\d{2}\.\d{2}$/;

// --- Helpers ---

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync('./package.json', 'utf8'));
}

function writePackageJson(pkg) {
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function incrementVersion(version) {
  const [major, minor] = version.split('.').map(Number);
  if (minor === 99) {
    return `${String(major + 1).padStart(2, '0')}.00`;
  }
  return `${String(major).padStart(2, '0')}.${String(minor + 1).padStart(2, '0')}`;
}

// --- Main ---

function handleVersioning() {
  if (!fs.existsSync('./package.json')) {
    console.error('package.json not found. Run this from the project root.');
    process.exit(1);
  }

  // 1. Check for uncommitted changes
  console.log('[1/7] Checking working tree...');
  const status = git('status --porcelain');
  if (status) {
    console.error('Uncommitted changes found:\n' + status);
    console.error('\nCommit or stash your changes first.');
    process.exit(1);
  }

  // 2. Verify branch
  console.log('[2/7] Verifying branch...');
  const branch = git('rev-parse --abbrev-ref HEAD');
  if (branch !== REQUIRED_BRANCH) {
    console.error(`Must be on "${REQUIRED_BRANCH}" (currently on "${branch}").`);
    process.exit(1);
  }

  // 3. Pull latest BEFORE building
  console.log('[3/7] Pulling latest changes...');
  try {
    const pullOutput = git('pull --ff-only');
    console.log(pullOutput || 'Already up to date.');
  } catch {
    console.error('Pull failed. Resolve conflicts or rebase manually.');
    process.exit(1);
  }

  // 4. Re-read package.json (pull may have updated it)
  console.log('[4/7] Validating version...');
  let pkg = readPackageJson();
  const currentVersion = pkg.version;

  if (!VERSION_REGEX.test(currentVersion)) {
    console.error(`Invalid version "${currentVersion}". Expected xx.xx format.`);
    process.exit(1);
  }
  console.log(`Current version: ${currentVersion}`);

  // 5. Build
  console.log('[5/7] Building...');
  try {
    execSync('npm run build', {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch {
    console.error('Build failed. Aborting.');
    process.exit(1);
  }

  // 6. Determine version and create tag
  console.log('[6/7] Tagging...');
  const existingTags = git('tag --list').split('\n').filter(Boolean);
  let newVersion = currentVersion;
  let versionBumped = false;

  if (existingTags.includes(currentVersion)) {
    newVersion = incrementVersion(currentVersion);
    console.log(`Tag "${currentVersion}" exists. Bumping to "${newVersion}".`);

    pkg.version = newVersion;
    writePackageJson(pkg);
    git('add package.json');
    git(`commit -m "Hotfix [${newVersion}]"`);
    versionBumped = true;
  }

  git(`tag -a "${newVersion}" -m "Hotfix [${newVersion}]"`);
  console.log(`Tagged: ${newVersion}`);

  // 7. Push with rollback on failure
  console.log('[7/7] Pushing...');
  try {
    if (versionBumped) {
      git(`push origin ${REQUIRED_BRANCH}`);
    }
    git('push origin --tags');
    console.log(`\nVersion ${newVersion} released successfully.`);
  } catch {
    console.error('Push failed. Rolling back local tag and commit...');
    git(`tag -d "${newVersion}"`);
    if (versionBumped) {
      git('reset HEAD~1');
      git('checkout -- package.json');
    }
    console.error('Rollback complete. Fix the issue and retry.');
    process.exit(1);
  }
}

handleVersioning();
