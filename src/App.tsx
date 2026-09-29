import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import './App.css'

type View = 'conversation' | 'memory' | 'brief'
type Employee = 'A' | 'B'

interface Customer {
  id: string
  name: string
  company: string
  product: string
  initials: string
  color: string
  preview: string
  conversation: string
}

interface Memory {
  id: string
  text: string
  type: string
  context: string | null
  timestamp: string | null
  employee: string
  source: string
  conversationId: string | null
}

interface BriefAnswer {
  currentSituation: string
  previousDiscussions: string[]
  openItems: Array<{ item: string; reason: string }>
  possibleNextSteps: string[]
}

interface BriefResult {
  answer: BriefAnswer | null
  text: string
  openItems: Array<{ item: string; reason: string }>
  memories: Memory[]
  grounded: boolean
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.')
  return body
}

function App() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState('CUST-001')
  const [employee, setEmployee] = useState<Employee>('A')
  const [view, setView] = useState<View>('conversation')
  const [draft, setDraft] = useState('')
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', company: '', product: '' })
  const [manualMemories, setManualMemories] = useState<Memory[]>([])
  const [memoryDraft, setMemoryDraft] = useState('')
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [brief, setBrief] = useState<BriefResult | null>(null)
  const [connected, setConnected] = useState(false)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [demoSeeded, setDemoSeeded] = useState(false)

  const customer = customers.find((item) => item.id === customerId)
  const visibleCustomers = customers.filter((item) => `${item.name} ${item.company} ${item.id}`.toLowerCase().includes(search.toLowerCase()))

  async function loadCustomerMemories(selectedCustomerId: string) {
    try {
      const memories = await request<Memory[]>(`/api/customers/${selectedCustomerId}/memories`)
      setManualMemories(memories)
    } catch {
      setManualMemories([])
    }
  }

  useEffect(() => {
    void Promise.all([
      request<Customer[]>('/api/customers'),
      request<{ connected: boolean }>('/api/status'),
    ]).then(([accounts, status]) => {
      setCustomers(accounts)
      setDraft(accounts.find((item) => item.id === 'CUST-001')?.conversation ?? '')
      setConnected(status.connected)
      return loadCustomerMemories('CUST-001')
    }).catch(() => setError('TeamMind could not reach its API. Start the local app services and retry.'))
  }, [])

  function selectCustomer(selected: Customer) {
    setCustomerId(selected.id)
    setDraft(selected.conversation)
    setBrief(null)
    setMemoryDraft('')
    setEditingMemoryId(null)
    setNotice('')
    setError('')
    void loadCustomerMemories(selected.id)
  }

  async function saveManualMemory() {
    const trimmed = memoryDraft.trim()
    if (!trimmed) return
    const method = editingMemoryId ? 'PUT' : 'POST'
    const path = editingMemoryId ? `/api/customers/${customerId}/memories/${editingMemoryId}` : `/api/customers/${customerId}/memories`
    try {
      await request<Memory>(path, {
        method,
        body: JSON.stringify({ text: trimmed, employee, source: editingMemoryId ? 'manual update' : 'manual note' }),
      })
      setMemoryDraft('')
      setEditingMemoryId(null)
      setNotice(editingMemoryId ? 'Memory note updated.' : 'Memory note added.')
      await loadCustomerMemories(customerId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The memory note could not be saved.')
    }
  }

  async function deleteManualMemory(memoryId: string) {
    try {
      await request<{ deleted: boolean }>(`/api/customers/${customerId}/memories/${memoryId}`, { method: 'DELETE' })
      setNotice('Memory note deleted.')
      await loadCustomerMemories(customerId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The memory note could not be deleted.')
    }
  }

  async function createCustomer() {
    if (!newCustomer.name.trim() || !newCustomer.company.trim() || !newCustomer.product.trim()) {
      setError('Add the customer name, company, and product before creating the profile.')
      return
    }

    try {
      const created = await request<Customer>('/api/customers', {
        method: 'POST',
        body: JSON.stringify(newCustomer),
      })
      setCustomers((previous) => [...previous, created])
      setCustomerId(created.id)
      setDraft(created.conversation)
      setShowCustomerForm(false)
      setNewCustomer({ name: '', company: '', product: '' })
      setNotice(`Customer ${created.name} was added.`)
      setView('conversation')
      await loadCustomerMemories(created.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The customer could not be created.')
    }
  }

  async function storeConversation() {
    if (!customer) return
    setWorking('store')
    setError('')
    setNotice('')
    try {
      await request('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ customerId, employee, transcript: draft }),
      })
      setNotice(`Conversation stored in Hindsight for ${customer.name}.`)
      setView('memory')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Conversation could not be stored.')
    } finally {
      setWorking('')
    }
  }

  async function retrieveBrief() {
    if (!customer) return
    setWorking('brief')
    setError('')
    setNotice('')
    try {
      const result = await request<BriefResult>('/api/brief', {
        method: 'POST',
        body: JSON.stringify({ customerId }),
      })
      setBrief(result)
      setView('brief')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The customer brief could not be retrieved.')
    } finally {
      setWorking('')
    }
  }

  async function seedDemo() {
    setWorking('seed')
    setError('')
    setNotice('')
    try {
      await request('/api/demo/seed', { method: 'POST', body: '{}' })
      setDemoSeeded(true)
      setNotice('Five fictional conversations were retained in their customer Hindsight banks.')
      setEmployee('B')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo histories could not be stored.')
    } finally {
      setWorking('')
    }
  }

  if (!customer) return <div className="boot-screen">Starting TeamMind...</div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="TeamMind home">
          <span className="brand-mark"><UsersRound size={17} strokeWidth={2.4} /></span>
          <span>teammind</span>
          <span className="brand-divider" />
          <span className="brand-subtitle">CUSTOMER CONTINUITY</span>
        </a>
        <div className="topbar-actions">
          <span className={`connection ${connected ? 'is-connected' : ''}`}>
            <span className="connection-dot" />
            {connected ? 'Hindsight connected' : 'Hindsight offline'}
          </span>
          <button className="button button-secondary seed-button" onClick={seedDemo} disabled={!!working} title="Store five fictional customer conversations in Hindsight">
            {working === 'seed' ? <RefreshCw size={15} className="spin" /> : <Database size={15} />}
            <span>{demoSeeded ? 'Refresh demo history' : 'Seed demo histories'}</span>
          </button>
          <button className="icon-button help-button" title="About TeamMind" aria-label="About TeamMind"><CircleHelp size={18} /></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="account-rail">
          <div className="rail-heading">
            <div>
              <p className="micro-label">TEAM WORKSPACE</p>
              <h2>Accounts <span>{customers.length}</span></h2>
            </div>
            <button className="icon-button" title="Search accounts" aria-label="Search accounts"><Search size={17} /></button>
          </div>
          <button className="button button-secondary" onClick={() => setShowCustomerForm((value) => !value)} style={{ margin: '0 0 12px', width: '100%' }}>
            {showCustomerForm ? 'Close customer form' : '+ Add customer'}
          </button>
          {showCustomerForm && <div style={{ margin: '0 0 12px', display: 'grid', gap: 8 }}>
            <input aria-label="Customer name" placeholder="Customer name" value={newCustomer.name} onChange={(event) => setNewCustomer((previous) => ({ ...previous, name: event.target.value }))} />
            <input aria-label="Company" placeholder="Company" value={newCustomer.company} onChange={(event) => setNewCustomer((previous) => ({ ...previous, company: event.target.value }))} />
            <input aria-label="Product" placeholder="Product" value={newCustomer.product} onChange={(event) => setNewCustomer((previous) => ({ ...previous, product: event.target.value }))} />
            <button className="button button-primary" onClick={() => void createCustomer()}>Create customer</button>
          </div>}
          <label className="search-field">
            <Search size={15} />
            <input aria-label="Search accounts" placeholder="Find an account" value={search} onChange={(event) => setSearch(event.target.value)} />
            <kbd>/</kbd>
          </label>
          <div className="account-list">
            {visibleCustomers.map((item) => (
              <button className={`account-row ${item.id === customerId ? 'selected' : ''}`} key={item.id} onClick={() => selectCustomer(item)}>
                <span className={`avatar avatar-${item.color}`}>{item.initials}</span>
                <span className="account-copy">
                  <span className="account-name">{item.name}</span>
                  <span className="account-preview">{item.preview}</span>
                </span>
                {item.id === customerId && <ChevronRight size={15} className="selected-chevron" />}
              </button>
            ))}
            {visibleCustomers.length === 0 && <p className="empty-search">No matching accounts</p>}
          </div>
          <div className="rail-footer">
            <span className="team-icon"><UsersRound size={16} /></span>
            <span><strong>Shared team memory</strong><small>Not tied to one employee</small></span>
          </div>
        </aside>

        <main className="main-panel">
          <div className="page-heading">
            <div>
              <div className="breadcrumb"><span>ACCOUNTS</span><ChevronRight size={13} /><span>{customer.id}</span></div>
              <h1>Context that <em>carries over.</em></h1>
              <p className="page-deck">The customer history stays when the person changes.</p>
            </div>
            <div className="handoff-progress" aria-label="Handoff flow">
              <span className="progress-person"><span className="progress-dot complete"><Check size={11} /></span> A learns</span>
              <span className="progress-line" />
              <span className="progress-memory"><Database size={13} /> Memory</span>
              <span className="progress-line" />
              <span className="progress-person"><span className={`progress-dot ${employee === 'B' ? 'complete' : ''}`}>{employee === 'B' ? <Check size={11} /> : 'B'}</span> B follows up</span>
            </div>
          </div>

          <section className="customer-header" aria-label="Selected customer">
            <div className={`avatar avatar-large avatar-${customer.color}`}>{customer.initials}</div>
            <div className="customer-identity">
              <div className="customer-title-line"><h2>{customer.name}</h2><span className="customer-id">{customer.id}</span></div>
              <p>{customer.company}<span className="identity-separator">/</span>{customer.product}</p>
            </div>
            <div className="owner-block">
              <span className="owner-label">HANDOFF SIMULATION</span>
              <div className="employee-switch" role="group" aria-label="Choose employee">
                <button className={employee === 'A' ? 'active' : ''} onClick={() => setEmployee('A')} aria-pressed={employee === 'A'}>Employee A</button>
                <button className={employee === 'B' ? 'active' : ''} onClick={() => setEmployee('B')} aria-pressed={employee === 'B'}>Employee B</button>
              </div>
            </div>
          </section>

          <nav className="view-tabs" aria-label="Customer workspace views">
            <button className={view === 'conversation' ? 'active' : ''} onClick={() => setView('conversation')}><FileText size={16} /> Conversation</button>
            <button className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}><Database size={16} /> Customer memory{brief?.memories.length ? <span className="tab-count">{brief.memories.length}</span> : null}</button>
            <button className={view === 'brief' ? 'active' : ''} onClick={() => void retrieveBrief()}><Sparkles size={16} /> Brief me <ArrowRight size={14} className="tab-arrow" /></button>
          </nav>

          {(error || notice) && <div className={`feedback ${error ? 'feedback-error' : 'feedback-success'}`} role={error ? 'alert' : 'status'}>
            {error ? <AlertTriangle size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            {error && !connected && <a href="https://hindsight.vectorize.io/developer/installation" target="_blank" rel="noreferrer">Connection setup <ArrowRight size={13} /></a>}
          </div>}

          {view === 'conversation' && <section className="view-content conversation-view">
            <div className="section-intro">
              <div><p className="micro-label">01 / CAPTURE CONTEXT</p><h2>A conversation worth keeping</h2></div>
              <span className="source-chip"><span className="tiny-dot" /> FICTIONAL DEMO</span>
            </div>
            <div className="conversation-meta"><span className="meta-icon"><Clock3 size={15} /></span><span>Customer conversation</span><span className="meta-divider" />{employee === 'A' ? 'Employee A · original account owner' : 'Employee B · new account owner'}</div>
            <label className="transcript-label" htmlFor="transcript">Transcript</label>
            <textarea id="transcript" className="transcript-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add the conversation to retain as customer memory..." />
            <div className="form-footer">
              <span><ShieldCheck size={14} /> Saved to {customer.id} only</span>
              <button className="button button-primary" onClick={() => void storeConversation()} disabled={!!working || !draft.trim()}>
                {working === 'store' ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                {working === 'store' ? 'Storing memory' : 'Store in Hindsight'}
                {working !== 'store' && <ArrowRight size={15} />}
              </button>
            </div>
            <div className="before-after">
              <div className="comparison-side comparison-before"><span className="comparison-label">WITHOUT SHARED MEMORY</span><p>“Could you remind me what you discussed?”</p></div>
              <ArrowRight size={17} className="comparison-arrow" />
              <div className="comparison-side comparison-after"><span className="comparison-label">WITH TEAMMIND</span><p>Relevant context, ready for the next teammate.</p></div>
            </div>
          </section>}

          {view === 'memory' && <section className="view-content memory-view">
            <div className="section-intro">
              <div><p className="micro-label">02 / PERSISTENT CUSTOMER MEMORY</p><h2>What the team knows</h2></div>
              <button className="button button-secondary retrieve-button" onClick={() => void retrieveBrief()} disabled={!!working}>
                {working === 'brief' ? <RefreshCw size={15} className="spin" /> : <RefreshCw size={15} />}
                Retrieve memories
              </button>
            </div>
            <div className="memory-edit-box">
              <label className="transcript-label" htmlFor="memory-note">Memory note</label>
              <textarea id="memory-note" className="transcript-input" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Add a customer memory note or update an existing one..." />
              <div className="form-footer">
                <span><ShieldCheck size={14} /> {editingMemoryId ? 'Updating a saved memory note' : 'Add a new shared memory note'}</span>
                <button className="button button-primary" onClick={() => void saveManualMemory()} disabled={!memoryDraft.trim()}>
                  {editingMemoryId ? 'Update memory' : 'Add memory'}
                </button>
              </div>
            </div>
            <p className="section-note">Hindsight recalls relevant facts from this customer's bank. Each entry shows who captured it and where it came from.</p>
            {manualMemories.length || brief?.memories.length ? <div className="memory-timeline">
              {[...manualMemories, ...(brief?.memories ?? [])].map((memory) => <article className="memory-entry" key={memory.id}>
                <span className="timeline-marker"><Database size={13} /></span>
                <div className="memory-entry-body">
                  <div className="memory-entry-meta"><span>{memory.employee}</span><span className="meta-divider" /><span>{memory.timestamp ? new Date(memory.timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not available'}</span><span className="memory-type">{memory.type}</span></div>
                  <p>{memory.text}</p>
                  <span className="memory-source">{memory.source}{memory.conversationId ? ` · ${memory.conversationId.slice(0, 12)}` : ''}</span>
                  {memory.type === 'manual' && <div className="memory-actions">
                    <button type="button" className="button button-secondary" onClick={() => { setEditingMemoryId(memory.id); setMemoryDraft(memory.text) }}>Edit</button>
                    <button type="button" className="button button-secondary" onClick={() => void deleteManualMemory(memory.id)}>Delete</button>
                  </div>}
                </div>
              </article>)}
            </div> : <div className="memory-empty">
              <div className="empty-icon"><Database size={19} /></div>
              <div><h3>No memories retrieved yet</h3><p>Store a conversation or retrieve this customer's Hindsight history.</p></div>
            </div>}
            <div className="memory-boundary"><ShieldCheck size={16} /><span>Scoped to <strong>{customer.id}</strong><small>Separate Hindsight bank · Employee A and B share this account memory</small></span></div>
          </section>}

          {view === 'brief' && <section className="view-content brief-view">
            <div className="section-intro brief-intro">
              <div><p className="micro-label">03 / TEAM HANDOFF</p><h2>Customer brief</h2><p className="brief-subtitle">Prepared for {employee === 'B' ? 'Employee B' : 'the next teammate'} · {customer.name}</p></div>
              <button className="icon-button refresh-brief" onClick={() => void retrieveBrief()} disabled={!!working} title="Refresh customer brief" aria-label="Refresh customer brief"><RefreshCw size={16} className={working === 'brief' ? 'spin' : ''} /></button>
            </div>
            {working === 'brief' ? <div className="brief-loading"><RefreshCw size={18} className="spin" /> Searching {customer.id}'s Hindsight memories...</div> : brief ? <>
              {!brief.grounded && <div className="no-history"><CircleHelp size={16} /><span>No relevant memories were cited for this brief. Check the customer memory or retain a conversation.</span></div>}
              <div className="brief-summary">
                <span className="brief-section-index">A</span>
                <div><p className="brief-label">CURRENT SITUATION</p><p className="brief-lead">{brief.answer?.currentSituation || brief.text}</p></div>
              </div>
              {brief.answer?.previousDiscussions?.length ? <div className="brief-section">
                <span className="brief-section-index">B</span>
                <div><p className="brief-label">PREVIOUS DISCUSSIONS</p><ul>{brief.answer.previousDiscussions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>
              </div> : null}
              {brief.openItems.length > 0 && <div className="attention-block">
                <div className="attention-heading"><span className="attention-icon"><AlertTriangle size={16} /></span><span>Attention <small>OPEN / UNCONFIRMED</small></span></div>
                {brief.openItems.map((item, index) => <div className="attention-item" key={`${index}-${item.item}`}><strong>{item.item}</strong><p>{item.reason}</p></div>)}
              </div>}
              {brief.answer?.possibleNextSteps?.length ? <div className="brief-section next-step-section">
                <span className="brief-section-index">C</span>
                <div><p className="brief-label">POSSIBLE NEXT STEP</p><ul>{brief.answer.possibleNextSteps.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul><span className="possibility-note">Possible action, not a confirmed customer commitment</span></div>
              </div> : null}
              <div className="brief-evidence"><ShieldCheck size={15} /><span>{brief.memories.length} recalled {brief.memories.length === 1 ? 'memory' : 'memories'} from {customer.id}</span><button onClick={() => setView('memory')}>View sources <ArrowRight size={13} /></button></div>
            </> : <div className="brief-empty">
              <div className="empty-icon"><Sparkles size={19} /></div>
              <div><h3>Start with what the team already knows</h3><p>TeamMind will retrieve this customer's memory and prepare a sourced handoff brief.</p><button className="button button-primary" onClick={() => void retrieveBrief()} disabled={!!working}><Sparkles size={15} /> Brief me <ArrowRight size={14} /></button></div>
            </div>}
          </section>}

          <footer className="workspace-footer"><span>TeamMind <span className="footer-separator">·</span> Shared customer memory</span><span>Memory lives with the account, not the session.</span></footer>
        </main>
      </div>
    </div>
  )
}

export default App
