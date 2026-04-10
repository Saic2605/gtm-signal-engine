import { EventEmitter2 } from 'eventemitter2'
import type { QualificationEvent } from '../types/index.js'

// Singleton event bus shared across the entire engine.
// Collectors emit signals; the scoring engine listens and fires lead.qualified.
export const bus = new EventEmitter2({ wildcard: true, delimiter: '.' })

// ─── Typed helpers ────────────────────────────────────────────────────────────

export function onLeadQualified(handler: (event: QualificationEvent) => void) {
  bus.on('lead.qualified', handler)
}

export function emitLeadQualified(event: QualificationEvent) {
  bus.emit('lead.qualified', event)
}
