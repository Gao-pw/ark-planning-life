import { readFileSync, writeFileSync } from 'node:fs';

const packageJsonPath = 'package.json';
const tauriConfigPath = 'src-tauri/tauri.conf.json';
const cargoTomlPath = 'src-tauri/Cargo.toml';
const cargoLockPath = 'src-tauri/Cargo.lock';

const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version}`);
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
tauriConfig.version = version;
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = readFileSync(cargoTomlPath, 'utf8').replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`,
);
writeFileSync(cargoTomlPath, cargoToml);

const cargoLock = readFileSync(cargoLockPath, 'utf8').replace(
  /(^name\s*=\s*"siroi_codeheart"\s*\r?\nversion\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`,
);
writeFileSync(cargoLockPath, cargoLock);

console.log(`Synced version ${version}`);
