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

const MESSAGES: Record<string, string> = {
  PERMISSION_DENIED:
    'Der Zugriff auf den Kalender wurde nicht erteilt. Öffne Systemeinstellungen → Datenschutz & Sicherheit → Kalender und erlaube den Zugriff.',
  PERMISSION_RESTRICTED:
    'Der Kalenderzugriff ist durch Systemrichtlinien gesperrt und lässt sich nicht selbst freischalten.',
  CALENDAR_NOT_FOUND:
    'Der angegebene Kalender existiert nicht. Rufe list_calendars auf, um gültige Kalender-IDs zu erhalten.',
  CALENDAR_READONLY:
    'Dieser Kalender ist schreibgeschützt. Wähle über list_calendars einen Kalender, bei dem allowsModifications true ist.',
  INVALID_INPUT: 'Die Anfrage war ungültig.',
  SAVE_FAILED: 'Der Termin konnte nicht gespeichert werden.',
  HELPER_MISSING:
    'Das Hilfsprogramm bin/calendar-helper wurde nicht gefunden. Baue es einmalig mit "npm run build:helper".',
  HELPER_CRASHED: 'Das Hilfsprogramm wurde unerwartet beendet.',
  HELPER_TIMEOUT: 'Das Hilfsprogramm hat nicht rechtzeitig geantwortet.',
}

const FALLBACK = 'Beim Zugriff auf den Kalender ist ein unerwarteter Fehler aufgetreten.'

/** Uebersetzt einen Fehlercode in Klartext fuer Claude. Nie ein Stacktrace. */
export function describeError(code: string, detail?: string): string {
  const base = MESSAGES[code] ?? FALLBACK
  return detail !== undefined && detail.length > 0 ? `${base} (Details: ${detail})` : base
}
