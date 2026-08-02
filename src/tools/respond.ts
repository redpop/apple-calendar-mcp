import { HelperError, describeError } from '../errors.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/**
 * Einzige Stelle, an der Fehler zu Antworten werden. Das Modell bekommt Klartext,
 * niemals einen Stacktrace.
 *
 * Bewusst ohne `: Promise<ToolResult>`-Rückgabetyp-Annotation an der Funktion:
 * `ToolResult` hat keine Indexsignatur, das SDK-eigene `CallToolResult` (aus
 * @modelcontextprotocol/server) aber schon — eine explizite Annotation macht
 * die Rückgabe nominell inkompatibel und lässt `registerTool` auf die
 * veraltete Raw-Shape-Überladung zurückfallen, was `inputSchema` ablehnt.
 * `satisfies` prüft dieselbe Form, ohne den Rückgabetyp festzunageln.
 */
export async function respond(produce: () => Promise<unknown>) {
  try {
    const result = await produce()
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } satisfies ToolResult
  } catch (error) {
    const text =
      error instanceof HelperError
        ? describeError(error.code, error.message)
        : describeError('UNKNOWN', error instanceof Error ? error.message : String(error))
    return { content: [{ type: 'text', text }], isError: true } satisfies ToolResult
  }
}
