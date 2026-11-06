// Creates the NUXT_PREVIEW_PASSWORD_HASH value for the protected client preview.   node scripts/preview/hash-password.mjs
// The password is read from the terminal WITHOUT echo (never from the command line, so it does not land in shell history) and is never printed or stored.
import { randomBytes, scryptSync } from 'node:crypto'
import readline from 'node:readline'

function readHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); else rl.output.write('') }
    rl.question(prompt, (a) => { rl.close(); process.stdout.write('\n'); resolve(a) })
  })
}

const pw = await readHidden('Preview password (min 12 characters, not echoed): ')
if (pw.length < 12) { console.error('Refusing: use at least 12 characters (a long passphrase is best).'); process.exit(1) }
const again = await readHidden('Repeat it: ')
if (again !== pw) { console.error('The two entries differ.'); process.exit(1) }
const salt = randomBytes(16)
const N = 16384, r = 8, p = 1
const hash = scryptSync(pw, salt, 32, { N, r, p })
console.log(['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$'))
console.error('\nPut this value in NUXT_PREVIEW_PASSWORD_HASH (server environment only), with NUXT_PREVIEW_USER set to the chosen user name.')
console.error('Share the password with the client through a separate channel. It is not recoverable from the hash.')
