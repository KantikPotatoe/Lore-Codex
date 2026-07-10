import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Calendar } from '../db'
import { absoluteToDate, formatDate } from '../calendar'
import { pageChronology, type ChronologyRole } from '../pageChronology'

const ROLE_LABEL: Record<ChronologyRole, string> = {
  linked: 'Linked',
  mention: 'Mention',
}

/** Rows shown before the "Show all N" control appears. */
export const COLLAPSED_COUNT = 8

/** The era is noise at aside width, so it is omitted here (the timeline shows it). */
function dateLabel(cal: Calendar, absolute: number): string {
  const { year, month, day } = absoluteToDate(cal, absolute)
  return formatDate(cal, year, month, day, { showEra: false })
}

/** "History": timeline events that reference this page — the entity-scoped
 *  chronology, as opposed to the global /timeline. Quiet when empty. */
export default function PageHistory({ pageId, title }: { pageId: string; title: string }) {
  const events = useLiveQuery(() => db.events.orderBy('startAbsolute').toArray(), [])
  const calendars = useLiveQuery(() => db.calendars.toArray(), [])
  const [expanded, setExpanded] = useState(false)

  const entries = useMemo(
    () => pageChronology(pageId, title, events ?? [], calendars ?? []),
    [pageId, title, events, calendars],
  )

  if (entries.length === 0) return null

  // Name the calendar on each row only when the chronology actually spans more
  // than one reckoning; single-calendar worlds stay clean.
  const multiCalendar = new Set(entries.map((e) => e.event.calendarId)).size > 1
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_COUNT)

  return (
    <div className="page-history">
      <div className="page-history-head">
        History <span className="backlinks-count">{entries.length}</span>
      </div>
      <ul className="page-history-list">
        {shown.map(({ event, calendar, roles }) => (
          <li key={event.id}>
            <Link to={`/timeline?event=${event.id}`} className="page-history-row">
              <span className="page-history-date">
                {calendar ? dateLabel(calendar, event.startAbsolute) : '—'}
                {calendar && event.endAbsolute != null &&
                  ` — ${dateLabel(calendar, event.endAbsolute)}`}
              </span>
              <span className="page-history-title">
                {event.icon && <span className="page-history-icon">{event.icon}</span>}
                {event.title}
              </span>
              {multiCalendar && calendar && (
                <span className="page-history-cal">{calendar.name}</span>
              )}
            </Link>
            <span className="appears-in-roles">
              {roles.map((r) => (
                <span key={r} className="appears-in-role">{ROLE_LABEL[r]}</span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {!expanded && entries.length > COLLAPSED_COUNT && (
        <button className="ghost-btn page-history-more" onClick={() => setExpanded(true)}>
          Show all {entries.length}
        </button>
      )}
    </div>
  )
}
