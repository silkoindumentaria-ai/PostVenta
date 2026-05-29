import { useState, useEffect, useCallback } from 'react'
import NewSessionModal from './components/NewSessionModal.jsx'
import ContactsTable from './components/ContactsTable.jsx'
import './App.css'

export default function App() {
  const [sessions, setSessions] = useState([])
  const [activeSource, setActiveSource] = useState('gm') // 'gm' | 'tn'
  const [activeId, setActiveId] = useState({ gm: null, tn: null })
  const [sessionData, setSessionData] = useState(null)
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const currentActiveId = activeId[activeSource]
  const sourceSessions = sessions.filter(s => (s.source || 'gm') === activeSource)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      const data = await res.json()
      setSessions(data)
      // Set default active tab per source if not set
      setActiveId(prev => {
        const gmFirst = data.find(s => (s.source || 'gm') === 'gm')
        const tnFirst = data.find(s => s.source === 'tn')
        return {
          gm: prev.gm ?? gmFirst?.id ?? null,
          tn: prev.tn ?? tnFirst?.id ?? null,
        }
      })
    } catch (e) {
      console.error('Error fetching sessions:', e)
    }
  }, [])

  useEffect(() => { fetchSessions() }, [])

  useEffect(() => {
    if (!currentActiveId) { setSessionData(null); return }
    setLoadingContacts(true)
    fetch(`/api/sessions/${currentActiveId}/contacts`)
      .then(r => r.json())
      .then(data => setSessionData(data))
      .catch(console.error)
      .finally(() => setLoadingContacts(false))
  }, [currentActiveId])

  const handleSessionCreated = (newSession) => {
    const src = newSession.source || 'gm'
    setSessions(prev => [{ ...newSession, total_contacts: newSession.total_contacts || 0, contacted_count: 0 }, ...prev])
    setActiveId(prev => ({ ...prev, [src]: newSession.id }))
    setShowModal(false)
  }

  const handleRefreshPhones = useCallback(async () => {
    if (!currentActiveId) return
    const res = await fetch(`/api/sessions/${currentActiveId}/contacts`)
    const data = await res.json()
    setSessionData(data)
  }, [currentActiveId])

  const handleFinishSession = async (sessionId) => {
    if (!window.confirm('¿Finalizar esta sesión de postventa? Se archivará y no aparecerá más en las pestañas.')) return
    await fetch(`/api/sessions/${sessionId}/finish`, { method: 'PATCH' })
    const remaining = sessions.filter(s => s.id !== sessionId)
    setSessions(remaining)
    if (currentActiveId === sessionId) {
      const next = remaining.find(s => (s.source || 'gm') === activeSource)
      setActiveId(prev => ({ ...prev, [activeSource]: next?.id ?? null }))
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
      return { ...prev, contacts: prev.contacts.map(c => c.id === contactId ? { ...c, contacted: contacted ? 1 : 0 } : c) }
    })
    setSessions(prev => prev.map(s => {
      if (s.id !== currentActiveId) return s
      const delta = contacted ? 1 : -1
      return { ...s, contacted_count: Math.max(0, (s.contacted_count || 0) + delta) }
    }))
  }

  const setTabActive = (id) => setActiveId(prev => ({ ...prev, [activeSource]: id }))

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-name">Silko</span>
          <span className="brand-sep">|</span>
          <span className="brand-sub">PostVenta</span>
        </div>
        <div className="source-selector">
          <button
            className={`source-btn source-gm ${activeSource === 'gm' ? 'source-active' : ''}`}
            onClick={() => setActiveSource('gm')}
          >
            <span className="source-dot" />
            Gestion Moda
          </button>
          <button
            className={`source-btn source-tn ${activeSource === 'tn' ? 'source-active' : ''}`}
            onClick={() => setActiveSource('tn')}
          >
            <span className="source-dot" />
            Tienda Nube
          </button>
        </div>
        <button className="btn-new-session" onClick={() => setShowModal(true)}>
          + Nueva sesión
        </button>
      </header>

      <div className="tabs-bar">
        {sourceSessions.map(s => (
          <button
            key={s.id}
            className={`tab ${s.id === currentActiveId ? 'tab-active' : ''}`}
            onClick={() => setTabActive(s.id)}
          >
            <span className="tab-name">{s.name}</span>
            <span className="tab-badge">{s.contacted_count || 0}/{s.total_contacts || 0}</span>
            <span
              className="tab-close"
              title="Finalizar sesión"
              onClick={e => { e.stopPropagation(); handleFinishSession(s.id) }}
            >×</span>
          </button>
        ))}
        {sourceSessions.length === 0 && (
          <span className="tabs-empty">Sin sesiones activas</span>
        )}
      </div>

      <main className="app-main">
        {sourceSessions.length === 0 && !loadingContacts && (
          <div className="empty-state">
            <div className="empty-icon">{activeSource === 'gm' ? '🏪' : '🛒'}</div>
            <h2>{activeSource === 'gm' ? 'Gestion Moda' : 'Tienda Nube'}</h2>
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
        {sessionData && !loadingContacts && currentActiveId && (
          <ContactsTable
            session={sessionData.session}
            contacts={sessionData.contacts}
            onToggle={handleContactToggle}
            onFinish={() => handleFinishSession(currentActiveId)}
            onRefreshPhones={handleRefreshPhones}
          />
        )}
      </main>

      {showModal && (
        <NewSessionModal
          source={activeSource}
          onClose={() => setShowModal(false)}
          onCreated={handleSessionCreated}
        />
      )}
    </div>
  )
}
