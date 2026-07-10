// src/routes/TimelineRoute.tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pageRepo, type TimelineEvent } from '../db'
import { resolveDisplayCalendar } from '../timelineDisplay'
import CalendarEditor from '../components/CalendarEditor'
import EmptyState from '../components/EmptyState'
import EventEditor from '../components/EventEditor'
import TimelineVertical from '../components/TimelineVertical'
import TimelineHorizontal from '../components/TimelineHorizontal'

export default function TimelineRoute() {
  const calendars = useLiveQuery(() => db.calendars.orderBy('createdAt').toArray(), []) ?? []
  const events    = useLiveQuery(() => db.events.orderBy('startAbsolute').toArray(), []) ?? []
  const allPages  = useLiveQuery(() => pageRepo.listByTitle(), []) ?? []

  const [displayCalId, setDisplayCalId]     = useState<string | null>(null)
  const [view, setView]                     = useState<'vertical' | 'horizontal'>('vertical')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [editingEvent, setEditingEvent]     = useState<TimelineEvent | undefined>(undefined)
  const [addingEvent, setAddingEvent]       = useState(false)
  const [managingCals, setManagingCals]     = useState(false)

  // Deep link (#/timeline?event=<id>) — mirrors MapRoute's `?pin=`. A stale or
  // deleted id resolves to nothing and the whole thing is a harmless no-op.
  const [searchParams] = useSearchParams()
  const focusEventId = searchParams.get('event')
  const focusEvent = focusEventId ? events.find((e) => e.id === focusEventId) : undefined

  const displayCal = resolveDisplayCalendar(calendars, displayCalId, focusEvent)

  const visibleEvents = categoryFilter
    ? events.filter((e) => e.category.toLowerCase().includes(categoryFilter.toLowerCase()))
    : events

  const categories = [...new Set(events.map((e) => e.category).filter(Boolean))].sort()

  // Scroll after the row has rendered. Re-runs as the live query fills in and as
  // the calendar changes, so it lands whether or not events had loaded on mount.
  useEffect(() => {
    if (!focusEventId) return
    document
      .getElementById(`tl-event-${focusEventId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusEventId, displayCal?.id, visibleEvents.length])

  if (!calendars.length) {
    return (
      <div className="timeline-empty">
        <h1>Timeline</h1>
        <p className="muted">
          No calendars yet. Create a calendar first, then start adding events.
        </p>
        <button className="primary-btn" onClick={() => setManagingCals(true)}>
          + Create calendar
        </button>
        {managingCals && <CalendarEditor onClose={() => setManagingCals(false)} />}
      </div>
    )
  }

  return (
    <div className="timeline-page">
      <div className="timeline-toolbar">
        <span className="timeline-toolbar-label">Reckoning:</span>
        <select
          value={displayCal?.id ?? ''}
          onChange={(e) => setDisplayCalId(e.target.value)}
          className="tl-select"
        >
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="tl-view-toggle">
          <button
            className={view === 'vertical' ? 'ghost-btn active' : 'ghost-btn'}
            onClick={() => setView('vertical')}
          >≡ List</button>
          <button
            className={view === 'horizontal' ? 'ghost-btn active' : 'ghost-btn'}
            onClick={() => setView('horizontal')}
          >⟷ Axis</button>
        </div>

        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="tl-select"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <span className="map-hint">{visibleEvents.length} events</span>

        <button
          className="ghost-btn"
          onClick={() => setManagingCals(true)}
        >⚙ Calendars</button>

        <button
          className="primary-btn"
          style={{ width: 'auto' }}
          onClick={() => setAddingEvent(true)}
        >+ Add event</button>
      </div>

      <div className="timeline-body">
        {visibleEvents.length === 0 ? (
          <EmptyState icon="⏳" title="History hasn't been recorded yet" message="Add your first event to begin the timeline.">
            <button className="primary-btn" style={{ width: 'auto' }} onClick={() => setAddingEvent(true)}>+ Add event</button>
          </EmptyState>
        ) : view === 'vertical' ? (
          <TimelineVertical
            events={visibleEvents}
            calendars={calendars}
            displayCalendar={displayCal}
            allPages={allPages}
            onEdit={(e) => setEditingEvent(e)}
            focusEventId={focusEventId}
          />
        ) : (
          <TimelineHorizontal
            events={visibleEvents}
            calendars={calendars}
            displayCalendar={displayCal}
            allPages={allPages}
            onEdit={(e) => setEditingEvent(e)}
          />
        )}
      </div>

      {managingCals && <CalendarEditor onClose={() => setManagingCals(false)} />}

      {(addingEvent || editingEvent) && (
        <EventEditor
          event={editingEvent}
          calendars={calendars}
          allPages={allPages}
          onClose={() => { setAddingEvent(false); setEditingEvent(undefined) }}
        />
      )}
    </div>
  )
}
