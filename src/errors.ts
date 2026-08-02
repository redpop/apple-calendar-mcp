/** Fehler mit einem Code, den die Swift-CLI oder die Bridge geliefert hat. */
export class HelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HelperError'
  }
}

/**
 * Diese Texte gehen an den MCP-Client und landen damit vor dem Nutzer — auf
 * Englisch, weil das Paket oeffentlich ausgeliefert wird.
 *
 * Sie sind an das Modell adressiert, das den Tool-Aufruf gemacht hat: Wo eine
 * Anweisung weiterhilft, steht sie da (welches Tool als naechstes, welches
 * Feld pruefen). Wo nur ein Mensch etwas tun kann, steht der Klickpfad.
 */
const MESSAGES: Record<string, string> = {
  PERMISSION_DENIED:
    'Calendar access was not granted. The user needs to open System Settings > Privacy & Security > Calendars, enable calendar-helper, and set it to Full Access under Options.',
  PERMISSION_RESTRICTED:
    'Calendar access is blocked by a system policy, such as parental controls or a managed device profile. The user cannot grant it themselves.',
  CALENDAR_NOT_FOUND:
    'No calendar with that identifier exists. Call list_calendars to get valid identifiers; they are not guessable and can change between machines.',
  CALENDAR_READONLY:
    'That calendar is read-only, which is normal for subscribed and holiday calendars. Call list_calendars and pick one where allowsModifications is true.',
  INVALID_INPUT: 'The request was rejected as invalid.',
  SAVE_FAILED: 'The event could not be saved to the calendar store.',
  HELPER_MISSING:
    'The calendar-helper binary is missing from the installation. Reinstalling the package should restore it.',
  HELPER_CRASHED: 'The calendar helper stopped unexpectedly. Retrying the request will start it again.',
  HELPER_TIMEOUT:
    'The calendar helper did not answer in time. On the very first call this usually means a permission dialog is waiting to be confirmed.',
}

const FALLBACK = 'An unexpected error occurred while accessing the calendar.'

/** Uebersetzt einen Fehlercode in Klartext fuer den Client. Nie ein Stacktrace. */
export function describeError(code: string, detail?: string): string {
  const base = MESSAGES[code] ?? FALLBACK
  return detail !== undefined && detail.length > 0 ? `${base} (Details: ${detail})` : base
}
