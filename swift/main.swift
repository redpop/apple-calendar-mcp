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
    ensureAccess(store)
    emit(["status": "authorized"])
}

// MARK: - Kalender

func hexColor(_ color: CGColor?) -> Any {
    guard let color = color,
          let space = CGColorSpace(name: CGColorSpace.sRGB),
          let converted = color.converted(to: space, intent: .defaultIntent, options: nil),
          let components = converted.components, components.count >= 3 else {
        return NSNull()
    }
    let channel = { (value: CGFloat) -> Int in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", channel(components[0]), channel(components[1]), channel(components[2]))
}

func calendarTypeLabel(_ type: EKCalendarType) -> String {
    switch type {
    case .local: return "local"
    case .calDAV: return "calDAV"
    case .exchange: return "exchange"
    case .subscription: return "subscription"
    case .birthday: return "birthday"
    @unknown default: return "unknown"
    }
}

func serializeCalendar(_ calendar: EKCalendar) -> [String: Any] {
    return [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "type": calendarTypeLabel(calendar.type),
        "source": calendar.source?.title ?? NSNull(),
        "color": hexColor(calendar.cgColor),
        "allowsModifications": calendar.allowsContentModifications,
    ]
}

// MARK: - Kommando: list-calendars

func commandListCalendars() -> Never {
    let store = EKEventStore()
    ensureAccess(store)
    let calendars = store.calendars(for: .event)
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    emit(["calendars": calendars.map(serializeCalendar)])
}

// MARK: - Events

func eventStatusLabel(_ status: EKEventStatus) -> String {
    switch status {
    case .none: return "none"
    case .confirmed: return "confirmed"
    case .tentative: return "tentative"
    case .canceled: return "canceled"
    @unknown default: return "unknown"
    }
}

/// Bildet das Ende eines ganztaegigen Events auf den letzten *enthaltenen* Tag ab.
func inclusiveEndDay(_ end: Date) -> Date {
    let calendar = Calendar.current
    let parts = calendar.dateComponents([.hour, .minute, .second], from: end)
    if parts.hour == 0 && parts.minute == 0 && parts.second == 0 {
        return calendar.date(byAdding: .day, value: -1, to: end) ?? end
    }
    return end
}

func serializeEvent(_ event: EKEvent) -> [String: Any] {
    let start = event.startDate ?? Date()
    let end = event.endDate ?? start
    let occurrence = event.occurrenceDate ?? start
    let identifier = event.eventIdentifier ?? ""

    var payload: [String: Any] = [
        "id": "\(identifier)::\(isoOut.string(from: occurrence))",
        "eventIdentifier": identifier,
        "occurrenceDate": isoOut.string(from: occurrence),
        "calendarId": event.calendar?.calendarIdentifier ?? "",
        "calendarTitle": event.calendar?.title ?? "",
        "title": event.title ?? "",
        "start": isoOut.string(from: start),
        "end": isoOut.string(from: end),
        "allDay": event.isAllDay,
        "startDay": NSNull(),
        "endDay": NSNull(),
        "location": event.location ?? NSNull(),
        "notes": event.notes ?? NSNull(),
        "url": event.url?.absoluteString ?? NSNull(),
        "isRecurring": event.hasRecurrenceRules,
        "status": eventStatusLabel(event.status),
    ]

    if event.isAllDay {
        payload["startDay"] = dayFormatter.string(from: start)
        payload["endDay"] = dayFormatter.string(from: inclusiveEndDay(end))
    }

    return payload
}

/// Loest Kalender-IDs auf. `nil` bedeutet: alle Kalender.
func resolveCalendars(_ ids: Any?, store: EKEventStore) -> [EKCalendar]? {
    guard let ids = ids as? [String], !ids.isEmpty else { return nil }
    let all = store.calendars(for: .event)
    var picked: [EKCalendar] = []
    for id in ids {
        guard let match = all.first(where: { $0.calendarIdentifier == id }) else {
            fail("CALENDAR_NOT_FOUND", "Ein Kalender mit der ID '\(id)' existiert nicht.")
        }
        picked.append(match)
    }
    return picked
}

// MARK: - Kommando: list-events

func commandListEvents() -> Never {
    let payload = readPayload()
    let store = EKEventStore()
    ensureAccess(store)

    let start = parseDate(payload["start"], field: "start")
    let end = parseDate(payload["end"], field: "end")
    guard end > start else {
        fail("INVALID_INPUT", "'end' muss nach 'start' liegen.")
    }

    let calendars = resolveCalendars(payload["calendarIds"], store: store)

    // events(matching:) liefert Wiederholungstermine bereits als expandierte Instanzen.
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    var events = store.events(matching: predicate)

    if let rawQuery = payload["query"] as? String {
        let needle = rawQuery.lowercased()
        if !needle.isEmpty {
            events = events.filter { event in
                (event.title ?? "").lowercased().contains(needle)
                    || (event.notes ?? "").lowercased().contains(needle)
            }
        }
    }

    events.sort { ($0.startDate ?? Date.distantPast) < ($1.startDate ?? Date.distantPast) }

    // Erst filtern, dann zaehlen, dann begrenzen — totalMatched meint die
    // Trefferzahl vor dem Abschneiden.
    let totalMatched = events.count
    var truncated = false
    if let maxResults = payload["maxResults"] as? Int, maxResults >= 0, totalMatched > maxResults {
        events = Array(events.prefix(maxResults))
        truncated = true
    }

    emit([
        "events": events.map(serializeEvent),
        "totalMatched": totalMatched,
        "truncated": truncated,
    ])
}

// MARK: - Kommando: create-event

/// Calendar.app legt Erinnerungen ganztaegiger Termine immer auf 09:00 des
/// gewaehlten Tages; "1 Tag vorher" ist dort TRIGGER:-PT15H (-24h + 9h).
/// Ein reiner Minutenoffset wuerde stattdessen um Mitternacht ausloesen.
func alarmOffset(minutesBefore: Int, allDay: Bool) -> TimeInterval {
    if allDay {
        let daysBefore = floor(Double(minutesBefore) / 1440.0)
        return -(daysBefore * 86400) + 32400
    }
    return -(Double(minutesBefore) * 60)
}

func commandCreateEvent() -> Never {
    let payload = readPayload()
    let store = EKEventStore()
    ensureAccess(store)

    guard let title = (payload["title"] as? String), !title.isEmpty else {
        fail("INVALID_INPUT", "Feld 'title' fehlt oder ist leer.")
    }

    let start = parseDate(payload["start"], field: "start")
    let end = parseDate(payload["end"], field: "end")
    guard end >= start else {
        fail("INVALID_INPUT", "'end' darf nicht vor 'start' liegen.")
    }

    let calendar: EKCalendar
    if let id = payload["calendarId"] as? String {
        guard let match = store.calendars(for: .event).first(where: { $0.calendarIdentifier == id }) else {
            fail("CALENDAR_NOT_FOUND", "Ein Kalender mit der ID '\(id)' existiert nicht.")
        }
        calendar = match
    } else {
        guard let fallback = store.defaultCalendarForNewEvents else {
            fail("CALENDAR_NOT_FOUND", "Es ist kein Standardkalender für neue Termine konfiguriert.")
        }
        calendar = fallback
    }

    guard calendar.allowsContentModifications else {
        fail("CALENDAR_READONLY", "Der Kalender '\(calendar.title)' erlaubt keine Änderungen.")
    }

    let allDay = (payload["allDay"] as? Bool) ?? false

    let event = EKEvent(eventStore: store)
    event.calendar = calendar
    event.title = title
    event.startDate = start
    event.endDate = end
    event.isAllDay = allDay

    if let location = payload["location"] as? String { event.location = location }
    if let notes = payload["notes"] as? String { event.notes = notes }
    if let urlText = payload["url"] as? String, let url = URL(string: urlText) { event.url = url }

    if let alarms = payload["alarmMinutesBefore"] as? [Int] {
        for minutes in alarms {
            event.addAlarm(EKAlarm(relativeOffset: alarmOffset(minutesBefore: minutes, allDay: allDay)))
        }
    }

    do {
        try store.save(event, span: .thisEvent, commit: true)
    } catch {
        fail("SAVE_FAILED", "Der Termin konnte nicht gespeichert werden: \(error.localizedDescription)")
    }

    emit(["event": serializeEvent(event)])
}

// MARK: - Dispatch

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    fail("INVALID_INPUT", "Kein Kommando angegeben. Erwartet: check-access, list-calendars, list-events, create-event.")
}

switch arguments[1] {
case "check-access":
    commandCheckAccess()
case "list-calendars":
    commandListCalendars()
case "list-events":
    commandListEvents()
case "create-event":
    commandCreateEvent()
default:
    fail("INVALID_INPUT", "Unbekanntes Kommando: \(arguments[1])")
}
