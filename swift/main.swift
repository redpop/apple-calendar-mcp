import CoreGraphics
import EventKit
import Foundation

// MARK: - Ausgabe und Fehler

/// Schreibt strukturierte Fehler auf stderr und beendet mit Exit-Code 1.
/// Der Node-Layer parst genau dieses Format.
func fail(_ code: String, _ message: String) -> Never {
    let payload: [String: Any] = ["code": code, "message": message]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    FileHandle.standardError.write(data)
    FileHandle.standardError.write(Data("\n".utf8))
    exit(1)
}

/// Schreibt das Ergebnis als JSON auf stdout und beendet mit Exit-Code 0.
func emit(_ object: [String: Any]) -> Never {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
        fail("SAVE_FAILED", "Die Antwort konnte nicht als JSON kodiert werden.")
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

// MARK: - Eingabe

func readPayload() -> [String: Any] {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { return [:] }
    guard let object = try? JSONSerialization.jsonObject(with: data),
          let dictionary = object as? [String: Any] else {
        fail("INVALID_INPUT", "stdin enthielt kein gültiges JSON-Objekt.")
    }
    return dictionary
}

// MARK: - Datumsformate

/// Ausgabeformat: ISO 8601 mit lokalem Offset, damit Claude die Zeitzone sieht.
let isoOut: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone.current
    return formatter
}()

let isoWithFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

/// Reine Tagesangabe für ganztägige Events.
let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    return formatter
}()

func parseDate(_ value: Any?, field: String) -> Date {
    guard let text = value as? String else {
        fail("INVALID_INPUT", "Feld '\(field)' fehlt oder ist kein String.")
    }
    if let date = isoOut.date(from: text) { return date }
    if let date = isoWithFraction.date(from: text) { return date }
    fail("INVALID_INPUT", "Feld '\(field)' ist kein gültiges ISO-8601-Datum mit Offset: \(text)")
}

// MARK: - Berechtigung

/// Stellt sicher, dass Vollzugriff besteht. Bricht sonst mit klarem Fehler ab.
func ensureAccess(_ store: EKEventStore) {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess:
        return
    case .restricted:
        fail("PERMISSION_RESTRICTED", "Der Kalenderzugriff ist durch Systemrichtlinien gesperrt.")
    case .denied:
        fail("PERMISSION_DENIED", "Kalenderzugriff wurde verweigert. Aktiviere ihn unter Systemeinstellungen → Datenschutz & Sicherheit → Kalender.")
    default:
        break
    }

    guard #available(macOS 14.0, *) else {
        fail("PERMISSION_RESTRICTED", "Dieses Hilfsprogramm benötigt macOS 14 oder neuer.")
    }

    // Ein CLI-Prozess hat keinen RunLoop — der Callback muss per Semaphore abgewartet werden.
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    store.requestFullAccessToEvents { ok, _ in
        granted = ok
        semaphore.signal()
    }
    semaphore.wait()

    if !granted {
        fail("PERMISSION_DENIED", "Kalenderzugriff wurde nicht erteilt. Aktiviere ihn unter Systemeinstellungen → Datenschutz & Sicherheit → Kalender.")
    }
}

// MARK: - Kommando: check-access

func commandCheckAccess() -> Never {
    let store = EKEventStore()
    let status = EKEventStore.authorizationStatus(for: .event)

    if status == .notDetermined {
        ensureAccess(store)
        emit(["status": "authorized"])
    }

    let label: String
    switch status {
    case .notDetermined: label = "notDetermined"
    case .restricted: label = "restricted"
    case .denied: label = "denied"
    case .fullAccess: label = "authorized"
    case .writeOnly: label = "writeOnly"
    @unknown default: label = "unknown"
    }
    emit(["status": label])
}

// MARK: - Dispatch

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    fail("INVALID_INPUT", "Kein Kommando angegeben. Erwartet: check-access, list-calendars, list-events, create-event.")
}

switch arguments[1] {
case "check-access":
    commandCheckAccess()
default:
    fail("INVALID_INPUT", "Unbekanntes Kommando: \(arguments[1])")
}
