import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Button,
  Drawer,
  FileInput,
  Table,
  Tooltip,
} from '@mantine/core'
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowRight,
  IconBell,
  IconCalendarClock,
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconClock,
  IconCloudOff,
  IconFileUpload,
  IconHeartHandshake,
  IconHistory,
  IconLayoutDashboard,
  IconLock,
  IconRefresh,
  IconShieldCheck,
  IconStethoscope,
  IconX,
} from '@tabler/icons-react'
import { promptFixture, type HistoryItem, type MockWorkflowState } from './fixture'
import { RunRequestScope } from './api'
import type { OperationalReport } from './types'

type PageId = 'desk' | 'lead' | 'physician' | 'history'

const pageLinks: Array<{ id: PageId; label: string; icon: typeof IconActivity }> = [
  { id: 'desk', label: 'Intervention desk', icon: IconLayoutDashboard },
  { id: 'lead', label: 'Lead review', icon: IconShieldCheck },
  { id: 'physician', label: 'Physician offer', icon: IconStethoscope },
  { id: 'history', label: 'Audit & outcomes', icon: IconHistory },
]

const flowLabels: Record<MockWorkflowState, string> = {
  idle: 'No preview workflow',
  'proposal-preview': 'Local proposal preview',
  'lead-approved-preview': 'Local approval preview',
  'sent-simulation-preview': 'Simulated send preview',
  'accepted-simulation-preview': 'Simulated acceptance preview',
  'declined-simulation-preview': 'Simulated decline preview',
  'cancelled-preview': 'Local cancellation preview',
  'expired-preview': 'Local expiry preview',
}

const apiMode = import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock'
const reportEndpoint = import.meta.env.VITE_REPORT_ENDPOINT?.trim()

function getLocalTime() {
  return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
}

function routeFor(page: PageId) {
  return page === 'desk' ? '/' : `/${page}`
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [runNumber, setRunNumber] = useState(1)
  const [revision, setRevision] = useState(0)
  const [scenarioClock, setScenarioClock] = useState<string>(promptFixture.originalScenarioClock)
  const [modified, setModified] = useState(false)
  const [workflow, setWorkflow] = useState<MockWorkflowState>('idle')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [auditOpen, setAuditOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileNotice, setFileNotice] = useState('')
  const [localClockTicks, setLocalClockTicks] = useState(0)
  const [lastSuccess, setLastSuccess] = useState<string | null>(null)
  const requestScope = useRef(new RunRequestScope())
  const runId = apiMode === 'mock' ? `mock-run-${String(runNumber).padStart(2, '0')}` : ''

  const reportQuery = useQuery<OperationalReport>({
    queryKey: ['operational-report', reportEndpoint, runId],
    enabled: apiMode === 'live' && Boolean(reportEndpoint),
    queryFn: async ({ signal }) => {
      const scopedSignal = requestScope.current.createSignal()
      const abortFromQuery = () => requestScope.current.discardPending()
      signal.addEventListener('abort', abortFromQuery, { once: true })
      const response = await fetch(reportEndpoint!, { credentials: 'include', signal: scopedSignal })
      if (!response.ok) throw new Error(`Report request failed (${response.status})`)
      const result = await response.json() as OperationalReport
      if (!result.run_id || result.revision === undefined) throw new Error('Report is missing run context.')
      setLastSuccess(getLocalTime())
      return result
    },
    refetchInterval: () => document.visibilityState === 'visible' ? 2_000 : false,
    refetchIntervalInBackground: false,
  })

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && apiMode === 'live' && reportEndpoint) {
        void reportQuery.refetch()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [reportQuery.refetch])

  useEffect(() => {
    const timer = window.setInterval(() => setLocalClockTicks((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const activePage = useMemo<PageId>(() => {
    if (location.pathname.startsWith('/lead')) return 'lead'
    if (location.pathname.startsWith('/physician')) return 'physician'
    if (location.pathname.startsWith('/history')) return 'history'
    return 'desk'
  }, [location.pathname])

  const liveReport = reportQuery.data
  const activeRunId = apiMode === 'live' ? liveReport?.run_id ?? 'unavailable' : runId
  const activeRevision = apiMode === 'live' ? liveReport?.revision ?? 'unavailable' : revision
  const connectionLabel = apiMode === 'mock'
    ? 'Mock fixture'
    : reportQuery.isError
      ? 'Connection stale'
      : liveReport
        ? 'API connected'
        : 'Connecting'

  function recordPreview(next: MockWorkflowState, label: string) {
    if (apiMode !== 'mock') return
    const item: HistoryItem = { runId, state: next, label, time: getLocalTime() }
    setWorkflow(next)
    setModified(true)
    setRevision((value) => value + 1)
    setHistory((items) => [item, ...items])
  }

  function startNewRunPreview() {
    if (apiMode !== 'mock') return
    requestScope.current.discardPending()
    if (workflow !== 'idle') {
      setHistory((items) => [{
        runId,
        state: workflow,
        label: `Run archived · ${flowLabels[workflow]}`,
        time: getLocalTime(),
      }, ...items])
    }
    setRunNumber((value) => value + 1)
    setRevision(0)
    setScenarioClock(promptFixture.originalScenarioClock)
    setModified(false)
    setWorkflow('idle')
    setSelectedFile(null)
    setFileNotice('')
  }

  function advanceScenarioClock() {
    if (apiMode !== 'mock') return
    setModified(true)
    setRevision((value) => value + 1)
    const [hourText, minuteText] = scenarioClock.split(':')
    const date = new Date(2000, 0, 1, Number(hourText), Number(minuteText) + 1)
    setScenarioClock(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
  }

  function selectCsv(file: File | null) {
    setSelectedFile(file)
    setFileNotice(file ? 'File selected. Server validation is unavailable; no rows were imported.' : '')
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link to="/" className="brand-lockup" aria-label="Sevaro Command Center home">
          <span className="brand-mark"><IconActivity size={20} stroke={2.3} /></span>
          <span className="brand-copy"><strong>Sevaro</strong><small>COMMAND CENTER</small></span>
        </Link>

        <div className="workspace-label">OPERATIONS</div>
        <nav className="side-nav" aria-label="Main navigation">
          {pageLinks.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`nav-item ${activePage === id ? 'active' : ''}`}
              onClick={() => navigate(routeFor(id))}
              aria-current={activePage === id ? 'page' : undefined}
            >
              <Icon size={18} stroke={1.8} />
              <span>{label}</span>
              {id === 'lead' && workflow === 'proposal-preview' && <span className="nav-dot" aria-label="Preview pending" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="preview-persona"><IconLock size={15} /><span>View preview only</span></div>
          <p>These views do not authenticate a user or grant an operational role.</p>
          <div className="build-tag">Challenge 2 · frontend prototype</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Sevaro</span><IconChevronRight size={14} /><strong>{pageLinks.find((item) => item.id === activePage)?.label}</strong></div>
          <div className="topbar-actions">
            <div className={`connection ${apiMode === 'live' && reportQuery.isError ? 'connection-error' : ''}`} role="status">
              <span className="connection-dot" />
              <span>{connectionLabel}</span>
            </div>
            {apiMode === 'live' && <span className="last-success">{lastSuccess ? `Updated ${lastSuccess}` : 'Not refreshed yet'}</span>}
            <div className="clock-chip"><IconClock size={15} /><span>Scenario {scenarioClock}</span></div>
            <Tooltip label="This is wall-clock time; separate from the scenario clock" withArrow>
              <span className="wall-clock">{new Date(Date.now() + localClockTicks * 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local</span>
            </Tooltip>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconRefresh size={15} />}
              onClick={apiMode === 'mock' ? advanceScenarioClock : () => void reportQuery.refetch()}
              disabled={apiMode === 'live' && !reportEndpoint}
              aria-label={apiMode === 'mock' ? 'Advance preview scenario clock' : 'Refresh report'}
            >
              {apiMode === 'mock' ? 'Advance preview' : 'Refresh'}
            </Button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="mode-banner" role="note">
            <span className="mode-icon"><IconAlertTriangle size={17} /></span>
            <div>
              <strong>{apiMode === 'mock' ? 'MOCK PREVIEW · no server writes' : 'LIVE API MODE · verified report required'}</strong>
              <p>{apiMode === 'mock'
                ? 'Preview controls update local UI state only. No proposal, approval, offer, or audit event is sent to a server.'
                : reportQuery.isError
                  ? 'The current report could not be refreshed. Displayed live data may be stale; review before any action.'
                  : 'Operational actions stay unavailable until the shared contract provides routes, session CSRF configuration, and generated report types.'}</p>
            </div>
            {apiMode === 'mock' && <Badge color="red" variant="light">NOT OPERATIONAL</Badge>}
          </div>

          {apiMode === 'live' && !reportEndpoint && (
            <Alert className="stale-banner" color="yellow" icon={<IconCloudOff size={18} />} title="Live report endpoint is not configured">
              Mock data is disabled in live mode. No fixture will be substituted for a missing or failed API report.
            </Alert>
          )}
          {apiMode === 'live' && reportQuery.isError && (
            <Alert className="stale-banner" color="red" icon={<IconCloudOff size={18} />} title="Report refresh failed">
              {reportQuery.error instanceof Error ? reportQuery.error.message : 'The API request failed.'} {lastSuccess ? `Last successful refresh: ${lastSuccess}.` : 'No successful refresh yet.'}
            </Alert>
          )}

          <Routes>
            <Route path="/" element={<DeskPage
              apiMode={apiMode}
              report={liveReport}
              reportLoading={reportQuery.isLoading}
              runId={activeRunId}
              revision={activeRevision}
              scenarioClock={scenarioClock}
              modified={modified}
              workflow={workflow}
              selectedFile={selectedFile}
              fileNotice={fileNotice}
              onFileSelect={selectCsv}
              onStartProposal={() => recordPreview('proposal-preview', 'Local proposal preview created · no server write')}
              onAdvanceClock={advanceScenarioClock}
              onOpenAudit={() => setAuditOpen(true)}
            />} />
            <Route path="/lead" element={<LeadPage workflow={workflow} onAdvance={recordPreview} />} />
            <Route path="/physician" element={<PhysicianPage workflow={workflow} onAdvance={recordPreview} />} />
            <Route path="/history" element={<HistoryPage history={history} />} />
          </Routes>

          {apiMode === 'mock' && (
            <div className="bottom-actions">
              <span>Run <code>{activeRunId}</code> · revision <code>{activeRevision}</code> · fixture <code>{promptFixture.version}</code></span>
              <Button variant="subtle" size="xs" onClick={startNewRunPreview} leftSection={<IconRefresh size={14} />}>
                Start new-run preview
              </Button>
            </div>
          )}
        </div>
      </main>

      <Drawer opened={auditOpen} onClose={() => setAuditOpen(false)} title="Audit & outcomes" position="right" size="min(520px, 100vw)">
        <p className="drawer-intro">Local UI preview events only. This is not a server audit record.</p>
        <HistoryList history={history} />
      </Drawer>
    </div>
  )
}

function DeskPage(props: {
  apiMode: 'mock' | 'live'
  report?: OperationalReport
  reportLoading: boolean
  runId: string
  revision: string | number
  scenarioClock: string
  modified: boolean
  workflow: MockWorkflowState
  selectedFile: File | null
  fileNotice: string
  onFileSelect: (file: File | null) => void
  onStartProposal: () => void
  onAdvanceClock: () => void
  onOpenAudit: () => void
}) {
  const { apiMode, report, reportLoading, modified, workflow } = props
  const mock = apiMode === 'mock'
  const consultCount = mock ? promptFixture.consultCount : report?.consults.length
  const hospital = mock ? promptFixture.hospital : report?.consults[0]?.hospital
  const recommendation = mock ? promptFixture.recommendedPhysician : undefined
  const consultRows = report?.consults ?? []
  const candidateRows = mock
    ? promptFixture.candidates.map((candidate) => ({ ...candidate, display_name: candidate.label }))
    : report?.candidates ?? []

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="title-line"><h1>Intervention desk</h1><Badge variant="outline" color={modified ? 'cyan' : 'gray'}>{modified ? 'Live mock data' : 'Baseline preview'}</Badge></div>
          <p>Coverage, consult delays, and human-approved staffing actions in one view.</p>
        </div>
        <Button variant="default" leftSection={<IconClipboardList size={16} />} onClick={props.onOpenAudit}>Audit & outcomes</Button>
      </section>

      {mock && <div className="fixture-note"><IconBell size={15} /><span>{modified
        ? 'Live mock data after a preview event or clock change. The prompt’s 208-field baseline claim is not carried into a modified run.'
        : 'Prompt-derived fixture only. The prompt states 208 baseline fields match; this app has not independently verified that claim.'}</span></div>}

      <section className="signal-row" aria-label="Operational summary">
        <article className="signal-block signal-risk">
          <div className="signal-label"><IconAlertTriangle size={16} /> Staffing risk</div>
          <strong className="signal-value unknown">{mock ? 'Awaiting report' : reportLoading ? 'Loading' : 'Unavailable'}</strong>
          <span className="signal-foot">Severity and affected scope must come from the API.</span>
        </article>
        <article className="signal-block">
          <div className="signal-label"><IconActivity size={16} /> Consult demand</div>
          <strong className="signal-value">{consultCount ?? '—'} <small>{consultCount !== undefined ? `at ${hospital}` : ''}</small></strong>
          <span className="signal-foot">Count from {mock ? 'the prompt fixture' : 'current report'}; individual delay ranks unavailable.</span>
        </article>
        <article className="signal-block">
          <div className="signal-label"><IconHeartHandshake size={16} /> Scoped recommendation</div>
          <strong className="signal-value">{recommendation ?? report?.recommendation?.candidate_id ?? 'Not supplied'}</strong>
          <span className="signal-foot">{mock ? 'Candidate rationale and eligibility not supplied.' : 'Review source explanation before acting.'}</span>
        </article>
        <article className="signal-block">
          <div className="signal-label"><IconCalendarClock size={16} /> Coverage horizon</div>
          <strong className="signal-value">90 <small>minutes</small></strong>
          <span className="signal-foot">Forecast values require a current backend report.</span>
        </article>
      </section>

      <section className="desk-grid">
        <div className="desk-primary">
          <section className="panel issue-panel">
            <PanelHeading title="Priority consults" detail="Ranked by source-provided delay" right={<Badge color="gray" variant="light">{consultRows.length || consultCount || 0} records</Badge>} />
            {mock ? (
              <div className="unavailable-state">
                <div className="state-symbol"><IconClock size={19} /></div>
                <div><strong>Consult-level delay ranking not in fixture</strong><p>The prompt gives a five-consult Suncrest count, but no IDs, urgency, waiting times, or ranking. No fabricated queue is shown.</p></div>
              </div>
            ) : reportLoading ? <SkeletonRows /> : consultRows.length ? (
              <Table className="ops-table" horizontalSpacing="sm" verticalSpacing="sm">
                <Table.Thead><Table.Tr><Table.Th>Consult</Table.Th><Table.Th>Hospital</Table.Th><Table.Th>Delay</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{consultRows.map((row) => <Table.Tr key={row.id}>
                  <Table.Td><strong>{row.id}</strong></Table.Td><Table.Td>{row.hospital}</Table.Td><Table.Td>{row.delay_minutes === undefined ? 'Not reported' : `${row.delay_minutes} min`}</Table.Td><Table.Td>{row.status}</Table.Td>
                </Table.Tr>)}</Table.Tbody>
              </Table>
            ) : <EmptyState text="No consult records in the current report." />}
          </section>

          <section className="panel timeline-panel">
            <PanelHeading title="90-minute coverage timeline" detail="Current availability · routability · planned capacity" right={<span className="legend"><i className="legend-current" /> Current <i className="legend-planned" /> Planned after ETA</span>} />
            <div className="capacity-labels"><span>Current available</span><span>Planned accepted</span><span>Required</span></div>
            <div className="timeline-bars" role="img" aria-label="Six 15-minute forecast intervals; coverage values are unavailable pending an API report.">
              {Array.from({ length: 6 }, (_, index) => <div className="timeline-bin" key={index}>
                <div className="bin-track"><span className="bin-pending">?</span></div>
                <small>{index * 15}–{(index + 1) * 15}m</small>
              </div>)}
            </div>
            <div className="inline-note"><IconAlertTriangle size={15} /><span>Persistent-activity forecast and remaining gaps are not available from the supplied data.</span></div>
          </section>

          <section className="panel candidates-panel">
            <PanelHeading title="Candidate explanations" detail="All six slots shown; no candidate is treated as eligible without server evidence" right={<Badge color="orange" variant="light">Unverified</Badge>} />
            <div className="candidate-list">
              {candidateRows.map((candidate, index) => <article className="candidate-row" key={candidate.id}>
                <span className="candidate-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="candidate-main"><strong>{candidate.display_name}</strong><p>{candidate.explanation}</p></div>
                <Badge color="orange" variant="light">{candidate.eligibility}</Badge>
              </article>)}
            </div>
          </section>
        </div>

        <aside className="desk-secondary">
          <section className="panel action-panel">
            <PanelHeading title="Immediate escalation" detail="Must be tied to the top issue and current eligibility" />
            <div className="blocked-action">
              <span className="blocked-icon"><IconLock size={17} /></span>
              <div><strong>Action unavailable</strong><p>Top issue, current report revision, and eligible reassignment are not present in the supplied fixture.</p></div>
            </div>
            <Button fullWidth disabled leftSection={<IconArrowRight size={16} />}>Escalate top issue</Button>
            <p className="control-foot">No operational request will be sent from mock mode.</p>
            {mock && <div className="preview-divider"><span>WORKFLOW PREVIEW</span></div>}
            {mock && <>
              <p className="preview-copy">Preview the approval sequence locally. It does not create a proposal or indicate eligibility.</p>
              <Button variant="light" color="dark" fullWidth onClick={props.onStartProposal} disabled={workflow !== 'idle'}>
                {workflow === 'idle' ? 'Start local workflow preview' : flowLabels[workflow]}
              </Button>
            </>}
          </section>

          <section className="panel import-panel">
            <PanelHeading title="Dataset import" detail="Validation and duplicate counts are server-owned" />
            <FileInput
              accept=".csv,text/csv"
              value={props.selectedFile}
              onChange={props.onFileSelect}
              placeholder="Choose a CSV file"
              leftSection={<IconFileUpload size={16} />}
              clearable
              aria-label="Choose CSV file"
            />
            {props.fileNotice && <p className="file-notice" role="status">{props.fileNotice}</p>}
            <Button className="import-button" fullWidth variant="default" disabled={!props.selectedFile} leftSection={<IconFileUpload size={15} />}>
              Validate with server
            </Button>
            <span className="control-foot">Import stays disabled until the API contract is available.</span>
          </section>

          <section className="benchmark-panel">
            <div className="benchmark-heading"><IconActivity size={17} /><strong>Benchmark</strong><Badge color="gray" variant="light">Not configured</Badge></div>
            <p>Access-deficit minutes are not patient-wait savings. Financial inputs and results remain unconfigured.</p>
          </section>
        </aside>
      </section>
    </>
  )
}

function LeadPage({ workflow, onAdvance }: { workflow: MockWorkflowState; onAdvance: (next: MockWorkflowState, label: string) => void }) {
  const hasProposal = workflow !== 'idle'
  return <>
    <section className="page-heading"><div><h1>Lead review</h1><p>Review the proposal and its current context before approval.</p></div><Badge color="red" variant="light">Preview only · not authenticated</Badge></section>
    <div className="page-columns">
      <section className="panel detail-panel">
        <PanelHeading title="Approval queue" detail="Only server-created proposals can be approved operationally" />
        {!hasProposal ? <EmptyState text="No proposal is loaded for this session." /> : <>
          <div className="mock-record-banner"><IconAlertTriangle size={16} /> Local preview workflow · not a server proposal</div>
          <dl className="detail-list"><div><dt>Run context</dt><dd>Preview only</dd></div><div><dt>Candidate</dt><dd>Not selected · eligibility unavailable</dd></div><div><dt>Recommendation</dt><dd>Not bound to a live issue</dd></div><div><dt>Current preview state</dt><dd>{flowLabels[workflow]}</dd></div></dl>
          <div className="button-row">
            <Button onClick={() => onAdvance('lead-approved-preview', 'Lead approval preview · local only')} disabled={workflow !== 'proposal-preview'} leftSection={<IconCheck size={16} />}>Preview approval</Button>
            <Button variant="light" color="dark" onClick={() => onAdvance('sent-simulation-preview', 'Simulated send preview · local only')} disabled={workflow !== 'lead-approved-preview'} leftSection={<IconArrowRight size={16} />}>Preview simulated send</Button>
            <Button variant="default" onClick={() => onAdvance('cancelled-preview', 'Proposal cancellation preview · local only')} disabled={workflow.includes('accepted') || workflow.includes('declined')} leftSection={<IconX size={16} />}>Preview cancellation</Button>
          </div>
        </>}
      </section>
      <section className="panel detail-panel"><PanelHeading title="Review checks" detail="Server revalidation required before approval" />
        <ul className="check-list"><li><span className="check-pending">?</span><span>Current report revision and issue scope</span><b>Unavailable</b></li><li><span className="check-pending">?</span><span>Hard eligibility constraints</span><b>Unavailable</b></li><li><span className="check-pending">?</span><span>Downstream coverage impact</span><b>Unavailable</b></li><li><span className="check-pending">?</span><span>Approver identity from session</span><b>Not authenticated</b></li></ul>
      </section>
    </div>
  </>
}

function PhysicianPage({ workflow, onAdvance }: { workflow: MockWorkflowState; onAdvance: (next: MockWorkflowState, label: string) => void }) {
  const hasMockOffer = workflow === 'sent-simulation-preview'
  return <>
    <section className="page-heading"><div><h1>Physician offer</h1><p>A physician session should see only its own hospital-scoped offer.</p></div><Badge color="red" variant="light">Preview only · no session</Badge></section>
    <div className="physician-layout">
      <section className="physician-phone panel">
        <div className="phone-topline"><span>Sevaro</span><IconLock size={15} /><span>No signed-in identity</span></div>
        {!hasMockOffer ? <div className="physician-empty"><span className="empty-pulse"><IconStethoscope size={23} /></span><h2>No offer loaded</h2><p>Offer visibility must be filtered by the authenticated physician session on the server. This preview has no identity and will not show another physician's offer.</p></div> : <div className="local-offer">
          <div className="mock-record-banner"><IconAlertTriangle size={16} /> Simulated offer · local UI only</div>
          <div className="offer-meta">HOSPITAL DETAILS NOT PROVIDED</div><h2>Offer details unavailable</h2><p>No physician-specific or hospital-only offer data was supplied. This preview cannot show or accept an operational offer.</p>
          <div className="button-row physician-buttons"><Button onClick={() => onAdvance('accepted-simulation-preview', 'Physician accept preview · local only')} disabled={workflow !== 'sent-simulation-preview'} leftSection={<IconCheck size={16} />}>Preview accept</Button><Button variant="default" onClick={() => onAdvance('declined-simulation-preview', 'Physician decline preview · local only')} disabled={workflow !== 'sent-simulation-preview'} leftSection={<IconX size={16} />}>Preview decline</Button><Button variant="subtle" onClick={() => onAdvance('expired-preview', 'Offer expiry preview · local only')} disabled={workflow !== 'sent-simulation-preview'}>Preview expiry</Button></div>
        </div>}
      </section>
      <aside className="physician-explainer"><IconShieldCheck size={20} /><h2>Identity-scoped by design</h2><p>In production, the server session determines which physician can view and respond. A frontend actor selector is intentionally absent.</p></aside>
    </div>
  </>
}

function HistoryPage({ history }: { history: HistoryItem[] }) {
  return <>
    <section className="page-heading"><div><h1>Audit & outcomes</h1><p>Operational history should come from the backend audit API.</p></div><Badge color="red" variant="light">Local preview events only</Badge></section>
    <section className="panel history-panel"><PanelHeading title="Preview activity" detail="Not an authoritative audit trail" /><HistoryList history={history} /></section>
    <section className="panel outcome-panel"><PanelHeading title="Outcome verification" detail="Current availability is not planned capacity" /><div className="unavailable-state"><div className="state-symbol"><IconActivity size={18} /></div><div><strong>No server outcome available</strong><p>Accepted offers must add projected capacity only after ETA. No verified-online status or coverage improvement is inferred here.</p></div></div></section>
  </>
}

function HistoryList({ history }: { history: HistoryItem[] }) {
  if (!history.length) return <EmptyState text="No local preview events yet." />
  return <div className="history-list">{history.map((item, index) => <div className="history-entry" key={`${item.runId}-${item.time}-${index}`}><span className="history-icon"><IconClock size={15} /></span><div><strong>{item.label}</strong><p>{item.runId} · {item.time}</p></div><Badge color="gray" variant="light">Local</Badge></div>)}</div>
}

function PanelHeading({ title, detail, right }: { title: string; detail?: string; right?: React.ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{right}</div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span><IconClipboardList size={18} /></span><p>{text}</p></div>
}

function SkeletonRows() {
  return <div className="skeleton-rows" aria-label="Loading report"><span /><span /><span /></div>
}