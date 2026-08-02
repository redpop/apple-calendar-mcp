import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Fester Ort, von dem der Helper ausgefuehrt wird.
 *
 * Gemessen in ACM-5: macOS fuehrt die Kalenderberechtigung fuer
 * Kommandozeilenprogramme **pro Pfad**. Ein byte-identisches Binary an einem
 * anderen Ort loest einen neuen Berechtigungsdialog aus und bekommt einen
 * eigenen Eintrag in den Systemeinstellungen. Der Code-Hash spielt dagegen
 * keine Rolle — ein Rebuild am selben Pfad kostet nichts.
 *
 * Wuerde der Helper also dort laufen, wo npm ihn ablegt, muesste der Nutzer
 * bei jedem Update erneut zustimmen. Deshalb dieser feste Ort, unabhaengig
 * von Paketverzeichnis und Version.
 */
export function installedHelperPath(installDir: string = defaultInstallDir()): string {
  return join(installDir, 'calendar-helper')
}

export function defaultInstallDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'apple-calendar-mcp', 'bin')
}

/**
 * Stellt sicher, dass unter `installDir` eine aktuelle Kopie von
 * `packagedPath` liegt, und liefert den Pfad, von dem gestartet werden soll.
 *
 * Scheitert das aus irgendeinem Grund, wird der Paketpfad zurueckgegeben:
 * Dann haengt die Berechtigung zwar am wandernden Pfad und ein Update fragt
 * erneut — aber der Server funktioniert. Ein harter Abbruch waere hier die
 * schlechtere Wahl.
 */
export function ensureInstalledHelper(
  packagedPath: string,
  installDir: string = defaultInstallDir(),
): string {
  if (!existsSync(packagedPath)) return packagedPath

  const target = installedHelperPath(installDir)

  try {
    if (existsSync(target) && isIdentical(packagedPath, target)) return target

    mkdirSync(installDir, { recursive: true })

    // Nicht direkt ueber das Ziel schreiben: Ein laufender Helper laesst sich
    // unter macOS nicht ueberschreiben (ETXTBSY), und ein vorheriges Loeschen
    // wuerde den Pfad kurzzeitig aufgeben — genau das, woran die Berechtigung
    // haengt. Ein rename() ersetzt nur den Verzeichniseintrag; ein noch
    // laufender Prozess behaelt seine alte Inode und laeuft ungestoert
    // weiter.
    const staging = `${target}.tmp`
    copyFileSync(packagedPath, staging)
    chmodSync(staging, 0o755)
    renameSync(staging, target)

    return target
  } catch {
    // Auch das Aufraeumen kann scheitern — etwa wenn schon das Anlegen des
    // Verzeichnisses fehlschlug und `${target}.tmp` gar kein gueltiger Pfad
    // ist (ENOTDIR). `force: true` faengt nur ENOENT ab, nicht das. Ein
    // Fehler beim Aufraeumen darf den Rueckfall nicht verhindern.
    try {
      rmSync(`${target}.tmp`, { force: true })
    } catch {
      /* Rest eines fehlgeschlagenen Versuchs; nicht kritisch. */
    }
    return packagedPath
  }
}

/**
 * Vergleicht den Inhalt. Die Dateigroesse allein genuegt nicht — zwei
 * Builds koennen gleich gross und trotzdem verschieden sein, und dann bliebe
 * ein veraltetes Binary stehen. Bei rund 200 KB ist der volle Vergleich
 * ohnehin billiger als die Fehlersuche danach.
 */
function isIdentical(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}
