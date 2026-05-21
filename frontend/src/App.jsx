import { useState, useEffect, useCallback } from 'react'
import NewSessionModal from './components/NewSessionModal.jsx'
import ContactsTable from './components/ContactsTable.jsx'
import './App.css'

export default function App() {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      const data = await res.json()
      setSessions(data)
      if (data.length > 0 && !activeId) {
        setActiveId(data[0].id)
      }
    } catch (e) {
      console.error('Error fetching sessions:', e)
    }
  }, [activeId])

  useEffect(() => {
    fetchSessions()
  }, [])

  useEffect(() => {
    if (!activeId) {
      setSessionData(null)
      return
    }
    setLoadingContacts(true)
    fetch(`/api/sessions/${activeId}/contacts`)
      .then(r => r.json())
      .then(data => setSessionData(data))
      .catch(console.error)
      .finally(() => setLoadingContacts(false))
  }, [activeId])

  const handleSessionCreated = (newSession) => {
    setSessions(prev => [
      { ...newSession, total_contacts: newSession.total_contacts || 0, contacted_count: 0 },
      ...prev,
    ])
    setActiveId(newSession.id)
    setShowModal(false)
  }

  const handleFinishSession = async (sessionId) => {
    if (!window.confirm('¿Finalizar esta sesión de postventa? Se archivará y no aparecerá más en las pestañas.')) return
    await fetch(`/api/sessions/${sessionId}/finish`, { method: 'PATCH' })
    const remaining = sessions.filter(s => s.id !== sessionId)
    setSessions(remaining)
    if (activeId === sessionId) {
      setActiveId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  const handleContactToggle = async (contactId, contacted) => {
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacted }),
    })
    setSessionData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        contacts: prev.contacts.map(c =>
          c.id === contactId ? { ...c, contacted: contacted ? 1 : 0 } : c
        ),
      }
    })
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== activeId) return s
        const delta = contacted ? 1 : -1
        return { ...s, contacted_count: Math.max(0, (s.contacted_count || 0) + delta) }
      })
    )
  }

  const activeSession = sessions.find(s => s.id === activeId)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-name">Silko</span>
          <span className="brand-sep">|</span>
          <span className="brand-sub">PostVenta</span>
        </div>
        <button className="btn-new-session" onClick={() => setShowModal(true)}>
          + Nueva sesión
        </button>
      </header>

      <div className="tabs-bar">
        {sessions.map(s => {
          const pct = s.total_contacts > 0
            ? Math.round((s.contacted_count / s.total_contacts) * 100)
            : 0
          return (
            <button
              key={s.id}
              className={`tab ${s.id === activeId ? 'tab-active' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              <span className="tab-name">{s.name}</span>
              <span className="tab-badge">{s.contacted_count || 0}/{s.total_contacts || 0}</span>
              <span
                className="tab-close"
                title="Finalizar sesión"
                onClick={e => { e.stopPropagation(); handleFinishSession(s.id) }}
              >
                ×
              </span>
            </button>
          )
        })}
        {sessions.length === 0 && (
          <span className="tabs-empty">Sin sesiones activas</span>
        )}
      </div>

      <main className="app-main">
        {sessions.length === 0 && !loadingContacts && (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h2>Bienvenido a PostVenta Silko</h2>
            <p>Creá una nueva sesión para comenzar a contactar clientes por WhatsApp.</p>
            <button className="btn btn-primary large" onClick={() => setShowModal(true)}>
              + Crear primera sesión
            </button>
          </div>
        )}

        {loadingContacts && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Cargando contactos...</p>
          </div>
        )}

        {sessionData && !loadingContacts && (
          <ContactsTable
            session={sessionData.session}
            contacts={sessionData.contacts}
            onToggle={handleContactToggle}
            onFinish={() => handleFinishSession(activeId)}
          />
        )}
      </main>

      {showModal && (
        <NewSessionModal
          onClose={() => setShowModal(false)}
          onCreated={handleSessionCreated}
        />
      )}
    </div>
  )
}
