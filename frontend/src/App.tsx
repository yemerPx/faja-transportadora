import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type LogEntry = { timestamp: string; direction: string; message: string }
type Sample = { value: number; at: number }
type BackendEvent = {
  type: string
  timestamp?: string
  connected?: boolean
  port?: string
  selected_pwm?: number
  sent_pwm?: number
  running?: boolean
  ports?: string[]
  direction?: string
  message?: string
}

const DEFAULT_PORT = '/dev/ttyACM0'
const quickValues = [
  ['25 %', 64],
  ['50 %', 128],
  ['75 %', 191],
  ['100 %', 255],
] as const

function Icon({ name }: { name: 'bolt' | 'plug' | 'chart' | 'terminal' | 'power' | 'refresh' }) {
  const paths = {
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
    plug: <><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a6 6 0 0 1-12 0V8Z" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 2 5-6" /></>,
    terminal: <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>,
    power: <><path d="M12 2v10" /><path d="M18.4 6.6a8 8 0 1 1-12.8 0" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function SignalChart({ samples }: { samples: Sample[] }) {
  const points = useMemo(() => {
    const values = samples.length ? samples : [{ value: 0, at: 0 }]
    return values.map((sample, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
      const y = 100 - (sample.value / 255) * 88 - 6
      return `${x},${y}`
    }).join(' ')
  }, [samples])

  return (
    <svg className="signal-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Historial de PWM">
      <defs>
        <linearGradient id="signalFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#58d6b2" stopOpacity=".38" />
          <stop offset="100%" stopColor="#58d6b2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 20H100M0 50H100M0 80H100" className="grid-lines" />
      <polygon points={`0,100 ${points} 100,100`} fill="url(#signalFill)" />
      <polyline points={points} className="signal-line" />
    </svg>
  )
}

function App() {
  const [connected, setConnected] = useState(false)
  const [running, setRunning] = useState(false)
  const [port, setPort] = useState(DEFAULT_PORT)
  const [ports, setPorts] = useState<string[]>([DEFAULT_PORT])
  const [selectedPwm, setSelectedPwm] = useState(150)
  const [sentPwm, setSentPwm] = useState(0)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [samples, setSamples] = useState<Sample[]>([])
  const [lastMessage, setLastMessage] = useState('Sin mensajes aún')
  const [error, setError] = useState('')
  const [connectedAt, setConnectedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const appendLog = (entry: LogEntry) => {
    setLogs((current) => [...current.slice(-499), entry])
  }

  const addSample = (value: number) => {
    setSamples((current) => [...current.slice(-39), { value, at: Date.now() }])
  }

  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await invoke('backend_command', { command: { action, ...extra } })
      setError('')
    } catch {
      setError('El servicio serial no está disponible. Abra la aplicación con Tauri.')
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<string>('backend-event', (event) => {
      let message: BackendEvent
      try {
        message = JSON.parse(event.payload)
      } catch {
        return
      }
      if (message.type === 'ports' && message.ports) setPorts(message.ports)
      if (message.type === 'connection') {
        setConnected(Boolean(message.connected))
        if (message.port) setPort(message.port)
        setConnectedAt(message.connected ? Date.now() : null)
      }
      if (message.type === 'state') {
        setConnected(Boolean(message.connected))
        setRunning(Boolean(message.running))
        if (typeof message.selected_pwm === 'number') setSelectedPwm(message.selected_pwm)
        if (typeof message.sent_pwm === 'number') {
          setSentPwm(message.sent_pwm)
          addSample(message.sent_pwm)
        }
        if (message.port) setPort(message.port)
      }
      if (message.type === 'log' && message.message) {
        appendLog({ timestamp: message.timestamp ?? '--:--:--', direction: message.direction ?? 'INFO', message: message.message })
        if (message.direction === 'RX') setLastMessage(message.message)
      }
      if (message.type === 'error' && message.message) {
        setError(message.message)
        appendLog({ timestamp: message.timestamp ?? '--:--:--', direction: 'ERROR', message: message.message })
      }
    }).then((dispose) => { unlisten = dispose }).catch(() => setError('Modo navegador: ejecute npm run tauri dev para usar el Arduino.'))
    queueMicrotask(() => { void send('ports') })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : 0)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [connectedAt])

  const percentage = selectedPwm / 255 * 100
  const time = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  const changePwm = (value: number) => {
    setSelectedPwm(value)
    send('set_pwm', { value })
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Icon name="bolt" /></div>
          <div>
            <h1>Faja<span>Control</span></h1>
          </div>
        </div>
        <div className="header-status">
          <div className={`connection-pill ${connected ? 'online' : ''}`}><i />{connected ? 'Arduino conectado' : 'Arduino desconectado'}</div>
          <button className="icon-button" title="Actualizar puertos" onClick={() => send('ports')}><Icon name="refresh" /></button>
        </div>
      </header>

      <section className="hero-grid">
        <div className="panel motor-panel">
          <div className="section-label"><Icon name="power" /> ESTADO DEL MOTOR</div>
          <div className={`motor-orb ${running ? 'active' : ''}`}><span>{running ? 'ON' : 'OFF'}</span></div>
          <h2>{running ? 'MOTOR ENCENDIDO' : 'MOTOR APAGADO'}</h2>
          <p>{running ? `Enviando PWM ${sentPwm}` : 'Esperando una orden explícita'}</p>
          <div className="primary-actions">
            <button className="start" disabled={!connected || running} onClick={() => send('start')}><Icon name="power" /> ENCENDER</button>
            <button className="stop" disabled={!connected || !running} onClick={() => send('stop')}>APAGAR</button>
          </div>
        </div>

        <div className="panel pwm-panel">
          <div className="section-label"><Icon name="bolt" /> NIVEL PWM SOLICITADO</div>
          <div className="pwm-value"><strong>{selectedPwm}</strong><span>/ 255</span></div>
          <div className="percent">{percentage.toFixed(1)}<small>%</small></div>
          <input aria-label="Nivel PWM solicitado" type="range" min="0" max="255" value={selectedPwm} onChange={(event) => changePwm(Number(event.target.value))} />
          <div className="range-labels"><span>0</span><span>128</span><span>255</span></div>
          <div className="quick-buttons">{quickValues.map(([label, value]) => <button key={value} className={selectedPwm === value ? 'selected' : ''} onClick={() => changePwm(value)}>{label}</button>)}</div>
          <p className="disclaimer">Nivel PWM solicitado; no representa RPM ni velocidad física.</p>
        </div>

        <div className="panel connection-panel">
          <div className="section-label"><Icon name="plug" /> CONEXIÓN SERIAL</div>
          <label>Puerto Arduino</label>
          <div className="port-row">
            <div className="select-wrap">
              <select value={port} onChange={(event) => setPort(event.target.value)}>{ports.map((item) => <option key={item}>{item}</option>)}</select>
            </div>
            <button onClick={() => send('connect', { port })}>CONECTAR</button>
          </div>
          <div className="connection-details">
            <span><b>9600</b> baudios</span>
            <span><b>{connected ? 'ACTIVO' : 'EN ESPERA'}</b> enlace</span>
          </div>
          {error && <div className="error-message">{error}</div>}
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card"><span>Arduino</span><b className={connected ? 'mint' : ''}>{connected ? 'Conectado' : 'Desconectado'}</b></div>
        <div className="stat-card"><span>PWM seleccionado</span><b>{selectedPwm} <small>/ 255</small></b></div>
        <div className="stat-card"><span>PWM enviado</span><b>{sentPwm} <small>/ 255</small></b></div>
        <div className="stat-card"><span>Tiempo conectado</span><b>{connected ? time : '—'}</b></div>
      </section>

      <section className="lower-grid">
        <div className="panel chart-panel">
          <div className="chart-header"><div><div className="section-label"><Icon name="chart" /> SEÑAL PWM</div><h3>Historial de comandos enviados</h3></div><span className="chart-key"><i /> PWM enviado</span></div>
          <SignalChart samples={samples} />
          <div className="chart-scale"><span>255</span><span>128</span><span>0</span></div>
        </div>
        <div className="panel message-panel">
          <div className="section-label"><Icon name="terminal" /> ÚLTIMO MENSAJE</div>
          <p className="message-time">ARDUINO · {connected ? 'ENLACE ACTIVO' : 'SIN ENLACE'}</p>
          <div className="last-message">{lastMessage}</div>
          <div className="future-note">Sensores futuros: RPM, voltaje, corriente, potencia y temperatura requieren hardware adicional.</div>
        </div>
      </section>

      <section className="panel log-panel">
        <div className="chart-header"><div className="section-label"><Icon name="terminal" /> MONITOR SERIAL</div><span>{logs.length} / 500 eventos</span></div>
        <div className="log-list">{logs.length === 0 ? <p className="empty-log">El sidecar serial está listo. Seleccione un puerto y pulse Conectar.</p> : logs.map((entry, index) => <div className="log-line" key={`${entry.timestamp}-${index}`}><time>{entry.timestamp}</time><b className={entry.direction.toLowerCase()}>{entry.direction} →</b><span>{entry.message}</span></div>)}</div>
      </section>
    </main>
  )
}

export default App
