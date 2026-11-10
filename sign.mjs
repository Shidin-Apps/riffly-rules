// Writes latest.json: version manifest + Ed25519 signature over the file hashes.
// The private key never lives in this repo (default: ~/.tonik/rules_signing.key).
//   node sign.mjs --init            create the key pair if missing, print the public key
//   node sign.mjs [version] [minAppBuild]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keyPath = process.env.TONIK_RULES_KEY || path.join(os.homedir(), '.tonik', 'rules_signing.key');
const FILES = ['extractor.js', 'po_token.html', 'rules.json'];

function loadKey() {
  if (!fs.existsSync(keyPath)) {
    if (!process.argv.includes('--init')) throw new Error(`signing key not found at ${keyPath} (run: node sign.mjs --init)`);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  return crypto.createPrivateKey(fs.readFileSync(keyPath));
}

const privateKey = loadKey();
const publicRaw = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
console.log('public key (base64, embed in the app):', publicRaw.toString('base64'));
if (process.argv.includes('--init') && process.argv.length === 3) process.exit(0);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const previous = fs.existsSync('latest.json') ? JSON.parse(fs.readFileSync('latest.json', 'utf8')) : {};
const version = parseInt(args[0] || previous.version || 1, 10);
const minAppBuild = parseInt(args[1] || previous.minAppBuild || 1, 10);
const tag = 'v' + version;
const files = {};
for (const f of FILES) files[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// Canonical message; the app rebuilds exactly this string before verifying.
const message = [version, tag, minAppBuild, ...FILES.map((f) => `${f}:${files[f]}`)].join('|');
const sig = crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64');
fs.writeFileSync('latest.json', JSON.stringify({ version, tag, minAppBuild, files, sig }, null, 2) + '\n');
console.log('signed latest.json', tag);
