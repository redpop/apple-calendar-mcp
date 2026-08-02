import CoreGraphics
import Darwin
import EventKit
import Foundation

// MARK: - Strukturierter Fehler (fuer throwing-Pfade)

/// Dieselben Code/Message-Paare wie `fail(...)`, aber als Swift-Error statt
/// Prozessabbruch. Die einshot-Kommandos fangen ihn und rufen `fail` auf;
/// der Serve-Modus faengt ihn und schreibt eine {"ok":false,...}-Zeile.
struct HelperError: Error {
    let code: String
    let message: String
}

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
        fail("SAVE_FAILED", "The response could not be encoded as JSON.")
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
        fail("INVALID_INPUT", "stdin did not contain a valid JSON object.")
    }
    return dictionary
}

// MARK: - Datumsformate

/// Ausgabeformat: ISO 8601 mit lokalem Offset, damit das Modell die Zeitzone sieht.
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

func parseDate(_ value: Any?, field: String) throws -> Date {
    guard let text = value as? String else {
        throw HelperError(code: "INVALID_INPUT", message: "Field '\(field)' is missing or not a string.")
    }
    if let date = isoOut.date(from: text) { return date }
    if let date = isoWithFraction.date(from: text) { return date }
    throw HelperError(code: "INVALID_INPUT", message: "Field '\(field)' is not a valid ISO 8601 date with offset: \(text)")
}

// MARK: - Berechtigung

/// Stellt sicher, dass Vollzugriff besteht. Bricht sonst mit klarem Fehler ab.
///
/// `timeoutSeconds` ist standardmaessig `nil`: dann wartet der Callback ohne
/// Frist, was fuer die Einzelkommandos genau richtig ist — dort sitzt ein
/// Mensch vor dem Terminal und sieht den Systemdialog. Der Serve-Modus
/// uebergibt eine endliche Frist, damit ein unbeantworteter Dialog den
/// Tool-Aufruf nicht unbegrenzt blockiert: ohne Frist bleibt der Prozess
/// beobachtet unauffindbar haengen (kein Log, kein Exit) statt sichtbar zu
/// scheitern. Der Node-Layer raeumt der ersten Anfrage nach dem Start
/// entsprechend mehr Zeit ein — beide Fristen gehoeren zusammen.
func ensureAccess(_ store: EKEventStore, timeoutSeconds: Double? = nil) {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess:
        return
    case .restricted:
        fail("PERMISSION_RESTRICTED", "Calendar access is blocked by a system policy.")
    case .denied:
        fail("PERMISSION_DENIED", "Calendar access was denied. Enable it under System Settings > Privacy & Security > Calendars.")
    default:
        // Faengt sowohl .notDetermined (noch nie gefragt) als auch .writeOnly
        // (nur "Nur Hinzufuegen" erteilt) ab — beide muessen zur vollen
        // Anfrage unten eskalieren. .writeOnly hier versehentlich als
        // ausreichend zu behandeln war genau der Fehler, der live entdeckt
        // wurde; nicht "aufraeumen".
        break
    }

    guard #available(macOS 14.0, *) else {
        fail("PERMISSION_RESTRICTED", "This helper requires macOS 14 or newer.")
    }

    // Ein CLI-Prozess hat keinen RunLoop — der Callback muss per Semaphore abgewartet werden.
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    store.requestFullAccessToEvents { ok, _ in
        granted = ok
        semaphore.signal()
    }

    if let timeoutSeconds = timeoutSeconds {
        let timedOut = semaphore.wait(timeout: .now() + timeoutSeconds) == .timedOut
        if timedOut {
            // Weder erteilt noch verweigert — vom "denied"-Fall oben bewusst
            // unterschieden: dort hat TCC klar geantwortet, hier hat gar
            // niemand geantwortet (kein Dialog erschien oder ihn beantwortet
            // hat). Diese Unterscheidung ist der ganze Sinn der Frist.
            fail("PERMISSION_TIMEOUT", "Calendar access was neither granted nor denied within \(Int(timeoutSeconds)) seconds — nothing answered the request, possibly because no dialog appeared. Retry after granting access under System Settings > Privacy & Security > Calendars.")
        }
    } else {
        semaphore.wait()
    }

    if !granted {
        fail("PERMISSION_DENIED", "Calendar access was not granted. Enable it under System Settings > Privacy & Security > Calendars.")
    }
}

// MARK: - Kommando: check-access

/// Reine Payload-Logik: setzt voraus, dass der Zugriff bereits geprueft wurde
/// (einshot-Wrapper ruft `ensureAccess` vorher auf; im Serve-Modus geschah das
/// einmalig beim Start).
func performCheckAccess() -> [String: Any] {
    return ["status": "authorized"]
}

func commandCheckAccess() -> Never {
    let store = EKEventStore()
    ensureAccess(store)
    emit(performCheckAccess())
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

func performListCalendars(store: EKEventStore) -> [String: Any] {
    let calendars = store.calendars(for: .event)
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    return ["calendars": calendars.map(serializeCalendar)]
}

func commandListCalendars() -> Never {
    let store = EKEventStore()
    ensureAccess(store)
    emit(performListCalendars(store: store))
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
func resolveCalendars(_ ids: Any?, store: EKEventStore) throws -> [EKCalendar]? {
    guard let ids = ids as? [String], !ids.isEmpty else { return nil }
    let all = store.calendars(for: .event)
    var picked: [EKCalendar] = []
    for id in ids {
        guard let match = all.first(where: { $0.calendarIdentifier == id }) else {
            throw HelperError(code: "CALENDAR_NOT_FOUND", message: "No calendar with identifier '\(id)' exists.")
        }
        picked.append(match)
    }
    return picked
}

// MARK: - Kommando: list-events

func performListEvents(payload: [String: Any], store: EKEventStore) throws -> [String: Any] {
    let start = try parseDate(payload["start"], field: "start")
    let end = try parseDate(payload["end"], field: "end")
    guard end > start else {
        throw HelperError(code: "INVALID_INPUT", message: "'end' must be after 'start'.")
    }

    let calendars = try resolveCalendars(payload["calendarIds"], store: store)

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

    return [
        "events": events.map(serializeEvent),
        "totalMatched": totalMatched,
        "truncated": truncated,
    ]
}

func commandListEvents() -> Never {
    let payload = readPayload()
    let store = EKEventStore()
    ensureAccess(store)
    do {
        let result = try performListEvents(payload: payload, store: store)
        emit(result)
    } catch let error as HelperError {
        fail(error.code, error.message)
    } catch {
        fail("INTERNAL_ERROR", "Unexpected error: \(error.localizedDescription)")
    }
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

func performCreateEvent(payload: [String: Any], store: EKEventStore) throws -> [String: Any] {
    guard let title = (payload["title"] as? String), !title.isEmpty else {
        throw HelperError(code: "INVALID_INPUT", message: "Field 'title' is missing or empty.")
    }

    let start = try parseDate(payload["start"], field: "start")
    var end = try parseDate(payload["end"], field: "end")
    guard end >= start else {
        throw HelperError(code: "INVALID_INPUT", message: "'end' must not be before 'start'.")
    }

    let allDay = (payload["allDay"] as? Bool) ?? false

    // Ganztaegige Termine: EventKit liefert beim Lesen 23:59:59 des letzten
    // Tages (siehe inclusiveEndDay/serializeEvent), aber ein naheliegender
    // Aufrufer — insbesondere ein LLM, das die verbreitete halboffene
    // Bereichskonvention kennt — schickt stattdessen Mitternacht des
    // Folgetages. Ohne diese Normalisierung wuerde EventKit daraus einen
    // zusaetzlichen Tag machen. Beide Schreibweisen muessen auf denselben
    // Tag abbilden; inclusiveEndDay wird bewusst wiederverwendet statt einer
    // zweiten Implementierung.
    if allDay {
        let normalizedEnd = inclusiveEndDay(end)
        if normalizedEnd >= start {
            end = normalizedEnd
        }
    }

    let calendar: EKCalendar
    if let id = payload["calendarId"] as? String {
        guard let match = store.calendars(for: .event).first(where: { $0.calendarIdentifier == id }) else {
            throw HelperError(code: "CALENDAR_NOT_FOUND", message: "No calendar with identifier '\(id)' exists.")
        }
        calendar = match
    } else {
        guard let fallback = store.defaultCalendarForNewEvents else {
            throw HelperError(code: "CALENDAR_NOT_FOUND", message: "No default calendar for new events is configured.")
        }
        calendar = fallback
    }

    guard calendar.allowsContentModifications else {
        throw HelperError(code: "CALENDAR_READONLY", message: "Calendar '\(calendar.title)' does not allow modifications.")
    }

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
        throw HelperError(code: "SAVE_FAILED", message: "The event could not be saved: \(error.localizedDescription)")
    }

    return ["event": serializeEvent(event)]
}

func commandCreateEvent() -> Never {
    let payload = readPayload()
    let store = EKEventStore()
    ensureAccess(store)
    do {
        let result = try performCreateEvent(payload: payload, store: store)
        emit(result)
    } catch let error as HelperError {
        fail(error.code, error.message)
    } catch {
        fail("INTERNAL_ERROR", "Unexpected error: \(error.localizedDescription)")
    }
}

// MARK: - Gemeinsamer Dispatcher (Einzelkommando und Serve-Modus nutzen dieselbe Logik)

/// Fuehrt ein Kommando aus und liefert dessen Ergebnis-Payload oder wirft
/// einen HelperError — nie `exit()`. Setzt voraus, dass der Zugriff bereits
/// geprueft wurde (Serve-Modus prueft einmalig beim Start).
func executeCommand(_ command: String, payload: [String: Any], store: EKEventStore) throws -> [String: Any] {
    switch command {
    case "check-access":
        return performCheckAccess()
    case "list-calendars":
        return performListCalendars(store: store)
    case "list-events":
        return try performListEvents(payload: payload, store: store)
    case "create-event":
        return try performCreateEvent(payload: payload, store: store)
    default:
        throw HelperError(code: "INVALID_INPUT", message: "Unknown command: \(command)")
    }
}

// MARK: - Serve: Zeilenprotokoll

/// Eine Zeile Request-JSON: {"id":1,"command":"...","payload":{...}}
///
/// `id` ist optional und wird unveraendert in die Antwort gespiegelt. Der
/// Serve-Loop arbeitet strikt sequenziell, die Zuordnung waere also auch ohne
/// sie eindeutig — sie macht eine Desynchronisation aber zu einem lauten
/// Fehler statt zu einer stillen Vertauschung von Antworten.
struct ServeRequest {
    let id: Any?
    let command: String
    let payload: [String: Any]
}

func parseServeRequest(_ line: String) throws -> ServeRequest {
    guard let data = line.data(using: .utf8) else {
        throw HelperError(code: "INVALID_INPUT", message: "Line could not be decoded as UTF-8.")
    }
    guard let object = try? JSONSerialization.jsonObject(with: data),
          let dictionary = object as? [String: Any] else {
        throw HelperError(code: "INVALID_INPUT", message: "Line did not contain a valid JSON object.")
    }
    guard let command = dictionary["command"] as? String else {
        throw HelperError(code: "INVALID_INPUT", message: "Field 'command' is missing or not a string.")
    }
    let payload: [String: Any]
    switch dictionary["payload"] {
    case .none:
        payload = [:]
    case .some(let value):
        guard let dict = value as? [String: Any] else {
            throw HelperError(code: "INVALID_INPUT", message: "Field 'payload' must be a JSON object.")
        }
        payload = dict
    }
    return ServeRequest(id: dictionary["id"], command: command, payload: payload)
}

/// Baut die {"ok":true,"result":...} / {"ok":false,"error":{...}} Huelle und
/// kodiert sie als eine JSON-Zeile. Faellt niemals auf `fail`/`exit` zurueck.
func encodeServeResponse(_ object: [String: Any]) -> Data {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
        return Data("{\"ok\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"Antwort konnte nicht kodiert werden.\"}}\n".utf8)
    }
    var withNewline = data
    withNewline.append(0x0A)
    return withNewline
}

func handleServeLine(_ line: String, store: EKEventStore) -> Data {
    // Scheitert schon das Parsen, ist die ID unbekannt und bleibt weg. Der
    // Aufrufer ordnet eine Antwort ohne ID der aeltesten offenen Anfrage zu.
    var requestId: Any?
    var responseObject: [String: Any]
    do {
        let request = try parseServeRequest(line)
        requestId = request.id
        let result = try executeCommand(request.command, payload: request.payload, store: store)
        responseObject = ["ok": true, "result": result]
    } catch let error as HelperError {
        responseObject = ["ok": false, "error": ["code": error.code, "message": error.message]]
    } catch {
        responseObject = ["ok": false, "error": ["code": "INTERNAL_ERROR", "message": "Unexpected error: \(error.localizedDescription)"]]
    }
    if let requestId = requestId {
        responseObject["id"] = requestId
    }
    return encodeServeResponse(responseObject)
}

// MARK: - Serve: stdio

/// Schreibt eine Zeile auf stderr. stdout traegt im Serve-Modus ausschliesslich
/// das Zeilenprotokoll — eine Diagnosezeile dort wuerde die Antwort
/// korrumpieren, die der Node-Layer parst.
func serveLog(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

/// Liest von stdin, ruft `handle` fuer jede vollstaendige Zeile auf, bis der
/// Elternprozess seine Seite schliesst (EOF) oder ein Lesefehler auftritt.
func readStdinLines(handle: (String) -> Void) {
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)
    while true {
        let bytesRead = chunk.withUnsafeMutableBytes { pointer -> Int in
            read(STDIN_FILENO, pointer.baseAddress, pointer.count)
        }
        if bytesRead <= 0 { break }
        buffer.append(contentsOf: chunk[0..<bytesRead])
        while let newlineIndex = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[..<newlineIndex]
            buffer.removeSubrange(buffer.startIndex...newlineIndex)
            if let line = String(data: lineData, encoding: .utf8) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    handle(trimmed)
                }
            }
        }
    }
}

/// Wie lange der Serve-Start auf eine TCC-Antwort wartet, bevor er aufgibt.
/// Lang genug, dass ein Mensch einen Systemdialog bemerken und bestaetigen
/// kann; kurz genug, dass ein haengender Helper nicht wie ein toter wirkt.
/// Der Node-Layer raeumt der ERSTEN Anfrage nach dem Start entsprechend mehr
/// Zeit ein als jeder weiteren — beide Fristen gehoeren zusammen.
let serveAccessCheckTimeoutSeconds: Double = 30

/// Langlebiger Modus: eine JSON-Zeile Anfrage auf stdin, eine JSON-Zeile
/// Antwort auf stdout, bis der Elternprozess seine Seite schliesst.
///
/// Der Kalenderzugriff wird genau einmal beim Start geprueft — danach setzt
/// die Request-Verarbeitung ihn als gegeben voraus. Genau dafuer laeuft der
/// Prozess ueberhaupt langlebig: Prozessstart, Disclaim-Re-exec, Aufbau des
/// EKEventStore und die TCC-Pruefung fallen einmal an statt bei jedem
/// Tool-Aufruf.
func commandServe() -> Never {
    // Ist der Elternprozess weg, waehrend noch geschrieben wird, darf ein
    // EPIPE den Helper nicht toeten — das geordnete Ende ist EOF auf stdin.
    signal(SIGPIPE, SIG_IGN)

    serveLog("calendar-helper: checking calendar access (deadline \(Int(serveAccessCheckTimeoutSeconds))s)…")
    let store = EKEventStore()
    ensureAccess(store, timeoutSeconds: serveAccessCheckTimeoutSeconds)
    // PID mitschreiben: Wer im Log nachsieht, warum ein Tool-Aufruf haengt,
    // will den Prozess auch finden koennen.
    serveLog("calendar-helper: ready (PID \(getpid())).")

    readStdinLines { line in
        FileHandle.standardOutput.write(handleServeLine(line, store: store))
    }

    // EOF auf stdin: der MCP-Server ist beendet, es kommt nichts mehr.
    exit(0)
}

// MARK: - TCC-Selbstverantwortung

/// macOS ordnet die Kalenderberechtigung dem verantwortlichen ELTERNPROZESS
/// zu, nicht dem aufgerufenen Programm. Ein MCP-Client, der in seinem Bundle
/// keinen Kalender-Verwendungszweck deklariert, sperrt damit jeden Prozess
/// aus, den er startet — auch diesen Helper.
///
/// `responsibility_spawnattrs_setdisclaim` gibt diese Verantwortung ab: der
/// neu ausgefuehrte Prozess wird sein EIGENER TCC-Verantwortlicher, und macOS
/// liest die Usage-Description aus SEINER eingebetteten Info.plist. Dieselbe
/// private libSystem-API benutzt Chromium fuer seine Helper-Prozesse.
///
/// Aufgeloest wird sie per dlsym statt per Link: verschwindet das Symbol in
/// einem kuenftigen macOS, laeuft der Helper einfach ohne Disclaim weiter —
/// funktional so gesperrt wie vorher, aber ohne Ladefehler und ohne Absturz.
func reexecDisclaimed() {
    let marker = "CALENDAR_HELPER_DISCLAIMED"
    let debug = ProcessInfo.processInfo.environment["CALENDAR_HELPER_DEBUG"] != nil

    /// Diagnose gehoert auf stderr — stdout traegt ausschliesslich das
    /// JSON-Protokoll, das der Node-Layer parst.
    func log(_ message: String) {
        FileHandle.standardError.write(Data("calendar-helper: disclaim: \(message)\n".utf8))
    }

    // Marker gesetzt? Dann ist dies bereits der ersetzte Prozess. Ohne diese
    // Abbruchbedingung wuerde sich der Helper endlos selbst ersetzen.
    guard ProcessInfo.processInfo.environment[marker] == nil else { return }

    // RTLD_DEFAULT ist auf Darwin ((void *) -2).
    let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)
    guard let symbol = dlsym(rtldDefault, "responsibility_spawnattrs_setdisclaim") else {
        if debug { log("Symbol nicht vorhanden — weiter ohne") }
        return
    }
    typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
    let setDisclaim = unsafeBitCast(symbol, to: SetDisclaim.self)

    guard let executable = Bundle.main.executablePath else {
        if debug { log("eigener Pfad nicht ermittelbar — weiter ohne") }
        return
    }

    var attributes: posix_spawnattr_t?
    guard posix_spawnattr_init(&attributes) == 0 else { return }
    defer { posix_spawnattr_destroy(&attributes) }

    // POSIX_SPAWN_SETEXEC ersetzt dieses Prozessabbild an Ort und Stelle.
    // Ohne das Flag wuerde posix_spawn ein Kind erzeugen und dieser Prozess
    // liefe daneben weiter — zwei Prozesse, von denen einer nichts tut.
    guard posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETEXEC)) == 0 else { return }
    _ = setDisclaim(&attributes, 1)

    var environment = ProcessInfo.processInfo.environment
    environment[marker] = "1"

    var cArguments: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) }
    cArguments.append(nil)
    var cEnvironment: [UnsafeMutablePointer<CChar>?] = environment.map { strdup("\($0.key)=\($0.value)") }
    cEnvironment.append(nil)
    defer {
        for pointer in cArguments where pointer != nil { free(pointer) }
        for pointer in cEnvironment where pointer != nil { free(pointer) }
    }

    if debug { log("ersetze Prozessabbild (\(executable))") }

    var pid: pid_t = 0
    let result = posix_spawn(&pid, executable, nil, &attributes, &cArguments, &cEnvironment)

    // Mit SETEXEC kehrt ein erfolgreicher Spawn NIE zurueck. Alles ab hier
    // bedeutet, dass der Austausch gescheitert ist.
    log("fehlgeschlagen (\(String(cString: strerror(result)))) — weiter ohne")
}

// MARK: - Dispatch

// Muss vor jedem EventKit-Zugriff stehen: nach dem Austausch beginnt der
// Prozess von vorn, und alles davor liefe zweimal.
reexecDisclaimed()

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    fail("INVALID_INPUT", "No command given. Expected one of: check-access, list-calendars, list-events, create-event, serve.")
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
case "serve":
    commandServe()
default:
    fail("INVALID_INPUT", "Unknown command: \(arguments[1])")
}
