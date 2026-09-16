import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const version = read('package.json').version;
assert.equal(read('src-tauri/tauri.conf.json').version, version, 'Tauri/package version mismatch');
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert.equal(cargo, version, 'Cargo/package version mismatch');
if (process.env.GITHUB_REF_NAME) assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Tag/version mismatch');
if (process.argv[2]) {
  const manifest = read(process.argv[2]);
  assert.equal(manifest.version.replace(/^v/, ''), version);
  for (const platform of ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']) {
    const item = manifest.platforms[platform];
    assert.ok(item?.signature?.trim(), `Missing signature: ${platform}`);
    const url = new URL(item.url);
    assert.equal(url.origin, 'https://github.com');
    assert.ok(url.pathname.startsWith(`/Wylp/Lince/releases/download/v${version}/`), `Wrong asset URL: ${platform}`);
  }
}
console.log(`Release ${version}: validation passed`);
