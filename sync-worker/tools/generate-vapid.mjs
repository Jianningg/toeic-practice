import { generateVAPIDKeys } from 'web-push';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2] || '.vapid-keys.json');
const keys = generateVAPIDKeys();
await writeFile(destination, JSON.stringify({
  VAPID_PUBLIC: keys.publicKey,
  VAPID_PRIVATE: keys.privateKey,
  VAPID_SUBJECT: 'https://jianningg.github.io/toeic-practice/'
}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log('VAPID keys saved to ' + destination + '. Keep this file private and reuse the same keys for existing subscriptions.');
