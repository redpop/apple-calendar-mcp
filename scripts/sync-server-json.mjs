// Haelt server.json mit package.json im Gleichklang.
//
// server.json traegt die Version doppelt — einmal fuer den Server, einmal fuer
// das npm-Paket, auf das der Registry-Eintrag verweist. Beide von Hand zu
// pflegen geht genau einmal gut; tests/serverJson.test.ts wuerde eine
// Abweichung zwar melden, aber erst nachdem sie entstanden ist.
//
// Laeuft als npm-"version"-Hook, also zwischen Versionsbump und Commit, und
// noch einmal im Release-Workflow.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const packagePath = fileURLToPath(new URL('package.json', root))
const manifestPath = fileURLToPath(new URL('server.json', root))

const { version } = JSON.parse(readFileSync(packagePath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

manifest.version = version
for (const entry of manifest.packages) entry.version = version

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`server.json auf ${version} gesetzt`)
