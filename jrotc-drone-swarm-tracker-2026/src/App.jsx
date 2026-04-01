
import { useEffect, useMemo, useRef, useState } from 'react'

const CV_WS_URL = import.meta.env.VITE_CV_WS_URL ?? 'ws://localhost:8000/ws/tracks'
const CV_REPLAY_WS_URL = import.meta.env.VITE_CV_REPLAY_WS_URL ?? 'ws://localhost:8000/ws/replay'
const CV_VIDEO_URL = import.meta.env.VITE_CV_VIDEO_URL ?? 'http://localhost:8000/api/video/current'
const CV_LIVE_FRAME_URL = import.meta.env.VITE_CV_LIVE_FRAME_URL ?? 'http://localhost:8000/api/video/frame/latest'
const CV_AUDIT_URL = import.meta.env.VITE_CV_AUDIT_URL ?? 'http://localhost:8000/api/audit/recent'
const CV_HEALTH_URL = import.meta.env.VITE_CV_HEALTH_URL ?? 'http://localhost:8000/health'
const CV_DETECTOR_URL = import.meta.env.VITE_CV_DETECTOR_URL ?? 'http://localhost:8000/api/detector'
const CV_API_KEY = import.meta.env.VITE_CV_API_KEY ?? ''
const DEFAULT_PERDIX_MP4_URL = 'https://d2feh2mec89yza.cloudfront.net/media/video/1701/DOD_103983712/DOD_103983712-1024x576-1769k.mp4'
const DVIDS_MP4_URL = import.meta.env.VITE_DVIDS_PERDIX_MP4_URL ?? DEFAULT_PERDIX_MP4_URL
const DVIDS_HLS_URL = import.meta.env.VITE_DVIDS_PERDIX_HLS_URL ?? ''

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)) }
function fmt(n, d=0){ return (n===null||n===undefined||Number.isNaN(n)) ? '—' : n.toFixed(d) }

function polarToXY(cx, cy, radius, bearingDeg, rangeU){
  const a = (bearingDeg - 90) * Math.PI / 180
  const rr = radius * rangeU
  return { x: cx + rr*Math.cos(a), y: cy + rr*Math.sin(a) }
}

function makeTrack(id, t){
  const base = (id * 37) % 360
  const phase = (t/1000) * (0.10 + (id%7)*0.012)
  const bearing = (base + phase*160) % 360
  const rangeBase = 0.14 + ((id%10)/10)*0.82
  const wobble = Math.sin(phase*2 + id) * 0.07
  const range = clamp(rangeBase + wobble, 0.06, 0.98)

  const altBand = range < 0.35 ? 'LOW' : range < 0.7 ? 'MED' : 'HIGH'
  const type = id%11===0 ? 'multirotor' : id%7===0 ? 'fixedwing' : 'unknown'
  const conf = clamp(0.55 + (Math.sin(phase + id)+1)*0.20, 0.22, 0.98)
  const relSpeed = clamp(9 + Math.cos(phase*1.5 + id)*7, 0, 28)
  const heading = (bearing + 110 + Math.sin(phase + id)*26) % 360

  const flags = []
  if (conf < 0.5) flags.push('LOW_CONF')
  if (id%13===0 && Math.sin(phase*0.9) > 0.72) flags.push('OCCLUDED')
  if (id%29===0 && Math.sin(phase*0.7) > 0.83) flags.push('LOST')

  const bboxW = 22 + (id % 5) * 7
  const bboxH = 12 + (id % 4) * 5
  const bboxX = clamp(Math.round(((bearing % 360) / 360) * (640 - bboxW) + Math.sin(phase + id) * 20), 0, 640 - bboxW)
  const bboxY = clamp(Math.round(range * (360 - bboxH) + Math.cos(phase * 1.4 + id) * 14), 0, 360 - bboxH)

  return {
    id,
    callsign: `UAV-${String(id).padStart(2,'0')}`,
    type,
    bearing,
    range_u: range,
    heading,
    rel_speed_u: relSpeed,
    alt_band: altBand,
    confidence: conf,
    flags,
    bbox: [bboxX, bboxY, bboxW, bboxH],
    frame: Math.floor(t / 120),
  }
}

function groupClusters(tracks){
  const buckets = new Map()
  for (const tr of tracks){
    const b = Math.floor(tr.bearing/20)
    const r = Math.floor(tr.range_u/0.2)
    const key = `${b}-${r}`
    buckets.set(key, (buckets.get(key)||0)+1)
  }
  return [...buckets.entries()].map(([k,n])=>({k,n})).sort((a,b)=>b.n-a.n).slice(0,6)
}

function sev(track){
  if (track.flags.includes('LOST')) return 'bad'
  if (track.flags.includes('OCCLUDED')) return 'warn'
  if (track.confidence < 0.55) return 'warn'
  return 'ok'
}

function typeLabel(t){
  if (t==='fixedwing') return 'Fixed-wing'
  if (t==='multirotor') return 'Multirotor'
  return 'Unknown'
}

function detectorLabel(detector){
  if (!detector) return 'Unknown'
  return detector.toUpperCase()
}

function nowTS(){
  const d = new Date()
  return d.toISOString().slice(11,19)
}

let timelineEventId = 0
function makeTimelineEntry(kind, msg){
  timelineEventId += 1
  return { id: timelineEventId, kind, ts: nowTS(), msg }
}

function confidenceTrend(history){
  if (!history || history.length < 2) return 'flat'
  const delta = history[history.length - 1] - history[0]
  if (delta > 0.05) return 'up'
  if (delta < -0.05) return 'down'
  return 'flat'
}

function sparkPath(history, width=64, height=18){
  if (!history || history.length === 0) return ''
  return history.map((value, idx)=>{
    const x = history.length === 1 ? width / 2 : (idx / (history.length - 1)) * width
    const y = height - (clamp(value, 0, 1) * height)
    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function getContentWidth(element){
  if (!element) return 0

  const styles = window.getComputedStyle(element)
  const paddingLeft = parseFloat(styles.paddingLeft || '0')
  const paddingRight = parseFloat(styles.paddingRight || '0')
  return Math.max(0, element.getBoundingClientRect().width - paddingLeft - paddingRight)
}

function mapServiceTrack(track){
  const confidence = clamp(track.conf ?? track.confidence ?? 0, 0, 1)
  const flags = []
  if (confidence < 0.5) flags.push('LOW_CONF')
  if (track.missed) flags.push('LOST')

  return {
    id: track.track_id ?? track.id,
    callsign: `UAV-${String(track.track_id ?? track.id).padStart(2,'0')}`,
    type: track.class_name ?? 'unknown',
    bearing: track.bearing_deg ?? 0,
    range_u: clamp(track.range_u ?? 0, 0, 1),
    heading: track.heading_deg ?? 0,
    rel_speed_u: (track.speed_u ?? 0) * 20,
    alt_band: track.alt_band && track.alt_band !== 'UNKNOWN' ? track.alt_band : 'MED',
    confidence,
    flags,
    bbox: track.bbox ?? [0, 0, 0, 0],
    frame: track.frame ?? 0,
  }
}

export default function App(){
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [tick, setTick] = useState(0)
  const [selectedId, setSelectedId] = useState(7)
  const [notesById, setNotesById] = useState({})
  const [search, setSearch] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [showVectors, setShowVectors] = useState(true)
  const [rings, setRings] = useState(5)
  const [mode, setMode] = useState('live')
  const [focusMode, setFocusMode] = useState(false)
  const [focusTopHeight, setFocusTopHeight] = useState(520)
  const [hudEnabled, setHudEnabled] = useState(true)
  const [leftPaneWidth, setLeftPaneWidth] = useState(620)
  const [centerPaneWidth, setCenterPaneWidth] = useState(500)
  const [bottomPaneHeight, setBottomPaneHeight] = useState(104)
  const [dragState, setDragState] = useState(null)
  const [videoReady, setVideoReady] = useState(false)
  const [videoLoadError, setVideoLoadError] = useState(false)
  const [liveFrameUrl, setLiveFrameUrl] = useState(`${CV_LIVE_FRAME_URL}?frame=0`)
  const [serviceState, setServiceState] = useState({
    status: 'idle',
    channel: 'live',
    hasData: false,
    frame: 0,
    playbackSeconds: 0,
    fps: 30,
    tracks: [],
    message: 'Select a service mode.',
    frameSize: { width: 640, height: 360 },
  })
  const [confidenceById, setConfidenceById] = useState({})
  const [timeline, setTimeline] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [detectorModel, setDetectorModel] = useState('SIM')
  const [detectorBusy, setDetectorBusy] = useState(false)

  const timerRef = useRef(null)
  const wsRef = useRef(null)
  const videoRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const videoFrameCallbackRef = useRef(null)
  const midRef = useRef(null)
  const focusStackRef = useRef(null)

  const wsTargetUrl = mode === 'replay' ? CV_REPLAY_WS_URL : CV_WS_URL
  const serviceDriven = mode !== 'sim' && serviceState.hasData
  const playbackDisabled = serviceDriven
  const simFps = serviceState.fps > 0 ? serviceState.fps : 30
  const showVideoFallback = videoLoadError
  const showOverlayCanvas = !showVideoFallback && mode !== 'sim'
  const showVideoHud = !showVideoFallback && hudEnabled
  const focusVideoBoxStyle = focusMode
    ? { height: `${Math.max(180, focusTopHeight - 176)}px`, width: 'auto', aspectRatio: '16 / 9' }
    : undefined
  const splitterSize = 10
  const minLeftPane = 420
  const minCenterPane = 320
  const minRightPane = 320
  const minBottomPane = 96
  const maxBottomPane = 360
  const minFocusTopPane = 356
  const minFocusBottomPane = 220

  const startResize = (type, event)=>{
    event.preventDefault()
    event.stopPropagation()
    if (window.getSelection){
      window.getSelection()?.removeAllRanges()
    }
    document.body.classList.add('is-resizing')
    document.documentElement.classList.add('is-resizing')
    setDragState({ type })
  }

  useEffect(()=>{
    if (!dragState) return

    const onMove = (event)=>{
      if (dragState.type === 'left' || dragState.type === 'center'){
        const mid = midRef.current
        if (!mid) return
        const rect = mid.getBoundingClientRect()
        const offsetX = event.clientX - rect.left
        const contentWidth = getContentWidth(mid)
        const paddingOffset = (rect.width - contentWidth) / 2
        const availableWidth = contentWidth - (splitterSize * 2)
        const contentX = offsetX - paddingOffset

        if (dragState.type === 'left'){
          const maxLeft = availableWidth - centerPaneWidth - minRightPane
          setLeftPaneWidth(Math.round(clamp(contentX, minLeftPane, maxLeft)))
          return
        }

        const maxCenter = availableWidth - leftPaneWidth - minRightPane
        const nextCenter = contentX - leftPaneWidth - splitterSize
        setCenterPaneWidth(Math.round(clamp(nextCenter, minCenterPane, maxCenter)))
        return
      }

      if (dragState.type === 'bottom'){
        const nextBottom = window.innerHeight - event.clientY
        setBottomPaneHeight(Math.round(clamp(nextBottom, minBottomPane, maxBottomPane)))
        return
      }

      if (dragState.type === 'focus'){
        const focusStack = focusStackRef.current
        if (!focusStack) return

        const rect = focusStack.getBoundingClientRect()
        const contentHeight = rect.height
        const nextTop = clamp(
          event.clientY - rect.top,
          minFocusTopPane,
          contentHeight - splitterSize - minFocusBottomPane
        )
        setFocusTopHeight(Math.round(nextTop))
      }
    }

    const onUp = ()=>{
      setDragState(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.documentElement.style.userSelect = ''
      document.body.classList.remove('is-resizing')
      document.documentElement.classList.remove('is-resizing')
    }

    document.body.style.cursor = dragState.type === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    document.documentElement.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return ()=>{
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragState, centerPaneWidth, leftPaneWidth])

  useEffect(()=>{
    if (!focusMode) return

    const clampFocusHeight = ()=>{
      const focusStack = focusStackRef.current
      if (!focusStack) return

      const maxTop = Math.max(minFocusTopPane, focusStack.getBoundingClientRect().height - splitterSize - minFocusBottomPane)
      const nextTop = clamp(focusTopHeight, minFocusTopPane, maxTop)
      if (nextTop !== focusTopHeight){
        setFocusTopHeight(Math.round(nextTop))
      }
    }

    clampFocusHeight()
    window.addEventListener('resize', clampFocusHeight)
    return ()=> window.removeEventListener('resize', clampFocusHeight)
  }, [focusMode, focusTopHeight])

  useEffect(()=>{
    if (focusMode) return

    const clampPaneWidths = ()=>{
      const mid = midRef.current
      if (!mid) return

      const availableWidth = getContentWidth(mid) - (splitterSize * 2)
      const maxLeft = Math.max(minLeftPane, availableWidth - centerPaneWidth - minRightPane)
      const nextLeft = clamp(leftPaneWidth, minLeftPane, maxLeft)

      const maxCenter = Math.max(minCenterPane, availableWidth - nextLeft - minRightPane)
      const nextCenter = clamp(centerPaneWidth, minCenterPane, maxCenter)

      if (nextLeft !== leftPaneWidth){
        setLeftPaneWidth(Math.round(nextLeft))
      }
      if (nextCenter !== centerPaneWidth){
        setCenterPaneWidth(Math.round(nextCenter))
      }
    }

    clampPaneWidths()
    window.addEventListener('resize', clampPaneWidths)
    return ()=> window.removeEventListener('resize', clampPaneWidths)
  }, [focusMode, leftPaneWidth, centerPaneWidth])

  useEffect(()=>{
    clearInterval(timerRef.current)
    if (!playing || serviceDriven || videoReady) return
    timerRef.current = setInterval(()=> setTick(t=>t + (1 / simFps)), 1000 / (simFps * speed))
    return ()=> clearInterval(timerRef.current)
  }, [playing, speed, serviceDriven, videoReady, simFps])

  useEffect(()=>{
    const video = videoRef.current
    if (!video) return

    if (serviceDriven){
      video.pause()
      video.playbackRate = 1
      return
    }

    video.playbackRate = speed
    if (playing){
      video.play().catch(()=>{})
    } else {
      video.pause()
    }
  }, [playing, speed, serviceDriven])

  useEffect(()=>{
    const video = videoRef.current
    if (!video || serviceDriven) return

    if (Math.abs(video.currentTime - tick) > 0.35){
      video.currentTime = tick
    }
  }, [tick, serviceDriven])

  useEffect(()=>{
    const video = videoRef.current
    if (!video || serviceDriven || !videoReady || typeof video.requestVideoFrameCallback !== 'function'){
      return
    }

    let active = true

    const onFrame = (_now, metadata)=>{
      if (!active) return
      setTick(metadata.mediaTime)
      videoFrameCallbackRef.current = video.requestVideoFrameCallback(onFrame)
    }

    videoFrameCallbackRef.current = video.requestVideoFrameCallback(onFrame)

    return ()=>{
      active = false
      if (videoFrameCallbackRef.current !== null && typeof video.cancelVideoFrameCallback === 'function'){
        video.cancelVideoFrameCallback(videoFrameCallbackRef.current)
      }
      videoFrameCallbackRef.current = null
    }
  }, [serviceDriven, videoReady])

  useEffect(()=>{
    if (!serviceDriven) return
    setVideoLoadError(false)
    setLiveFrameUrl(`${CV_LIVE_FRAME_URL}?frame=${serviceState.frame}`)
  }, [serviceDriven, serviceState.frame])

  useEffect(()=>{
    if (!serviceDriven) return
    setTick(serviceState.playbackSeconds)
  }, [serviceDriven, serviceState.playbackSeconds])

  useEffect(()=>{
    setVideoLoadError(false)
    if (mode === 'sim'){
      if (wsRef.current) wsRef.current.close()
      setServiceState((prev)=>({
        ...prev,
        status: 'offline',
        channel: 'sim',
        hasData: false,
        frame: 0,
        playbackSeconds: 0,
        tracks: [],
        message: 'Simulation mode selected.',
      }))
      setTimeline((prev)=>[makeTimelineEntry('info', 'Simulation mode selected. CV service disconnected.'), ...prev].slice(0, 24))
      return
    }

    let active = true
    let retryTimer = null

    const connect = ()=>{
      if (!active) return
      setServiceState((prev)=>({
        ...prev,
        status: 'connecting',
        channel: mode,
        hasData: false,
        message: `Connecting to ${wsTargetUrl}`,
      }))

      const ws = new WebSocket(wsTargetUrl)
      wsRef.current = ws

      ws.onopen = ()=>{
        if (!active) return
        setServiceState((prev)=>({ ...prev, status: 'connected', message: `Connected to ${wsTargetUrl}` }))
      }

      ws.onmessage = (event)=>{
        if (!active) return
        const payload = JSON.parse(event.data)

        if (payload.type === 'hello'){
          const channel = payload.mode ?? mode
          setServiceState((prev)=>({
            ...prev,
            status: 'connected',
            channel,
            hasData: false,
            fps: payload.fps || prev.fps,
            message: `${payload.video} • ${Math.round(payload.fps || 0)} FPS`,
            frameSize: {
              width: payload.frame_w || prev.frameSize.width,
              height: payload.frame_h || prev.frameSize.height,
            },
          }))
          setTimeline((prev)=>[
            makeTimelineEntry('info', `${channel === 'replay' ? 'Replay' : 'Live'} channel ready at ${Math.round(payload.fps || 0)} FPS.`),
            ...prev,
          ].slice(0, 24))
          return
        }

        if (payload.type === 'tracks_snapshot'){
          const channel = payload.mode ?? mode
          setServiceState((prev)=>({
            ...prev,
            status: channel === 'replay' ? 'replay' : 'live',
            channel,
            hasData: true,
            frame: payload.frame_idx ?? payload.frame ?? 0,
            playbackSeconds: payload.playback_position_s ?? prev.playbackSeconds,
            tracks: (payload.tracks || []).map(mapServiceTrack),
            message: `Frame ${payload.frame_idx ?? payload.frame ?? 0} • ${(payload.tracks || []).length} tracks`,
          }))
          return
        }

        if (payload.type === 'track_drop'){
          setTimeline((prev)=>[
            makeTimelineEntry('warn', `Track ${payload.id} dropped from the active picture.`),
            ...prev,
          ].slice(0, 24))
          return
        }

        if (payload.type === 'detector_changed'){
          const nextDetector = detectorLabel(payload.detector)
          setDetectorModel(nextDetector)
          setTimeline((prev)=>[
            makeTimelineEntry('info', `Detector switched to ${nextDetector}. Tracker state reset.`),
            ...prev,
          ].slice(0, 24))
          return
        }

        if (payload.type === 'replay_reset'){
          setTimeline((prev)=>[
            makeTimelineEntry('info', 'Replay loop reset to frame 0.'),
            ...prev,
          ].slice(0, 24))
          return
        }

        if (payload.type === 'error'){
          setServiceState((prev)=>({
            ...prev,
            status: 'offline',
            hasData: false,
            frame: 0,
            tracks: [],
            message: payload.message || 'CV service error',
          }))
          setTimeline((prev)=>[
            makeTimelineEntry('bad', payload.message || 'CV service error.'),
            ...prev,
          ].slice(0, 24))
        }
      }

      ws.onclose = ()=>{
        if (!active) return
        setServiceState((prev)=>({
          ...prev,
          status: 'offline',
          hasData: false,
          frame: 0,
            tracks: [],
            message: 'CV service offline. Using simulation fallback.',
        }))
        setTimeline((prev)=>[
          makeTimelineEntry('warn', `${mode === 'replay' ? 'Replay' : 'Live'} channel closed. UI fell back to simulation.`),
          ...prev,
        ].slice(0, 24))
        retryTimer = window.setTimeout(connect, 3000)
      }

      ws.onerror = ()=>{
        ws.close()
      }
    }

    connect()

    return ()=>{
      active = false
      if (retryTimer) window.clearTimeout(retryTimer)
      if (wsRef.current) wsRef.current.close()
    }
  }, [mode, wsTargetUrl])

  const t = tick * 1000
  const simulatedTracks = useMemo(()=>{
    const list = []
    for (let i=1;i<=72;i++) list.push(makeTrack(i, t))
    return list
  }, [t])

  useEffect(()=>{
    if (mode === 'sim'){
      setAuditEvents([])
      setDetectorModel('SIM')
      return
    }

    let active = true

    const loadAudit = async ()=>{
      try {
        const response = await fetch(CV_AUDIT_URL)
        if (!response.ok) return
        const payload = await response.json()
        if (active){
          setAuditEvents(Array.isArray(payload.events) ? payload.events : [])
        }
      } catch {
        if (active){
          setAuditEvents([])
        }
      }
    }

    loadAudit()
    const timer = window.setInterval(loadAudit, 15000)
    return ()=>{
      active = false
      window.clearInterval(timer)
    }
  }, [mode])

  useEffect(()=>{
    if (mode === 'sim'){
      setDetectorModel('SIM')
      return
    }

    let active = true

    const loadHealth = async ()=>{
      try {
        const response = await fetch(CV_HEALTH_URL)
        if (!response.ok) return
        const payload = await response.json()
        if (active){
          setDetectorModel(detectorLabel(payload.detector))
        }
      } catch {
        if (active){
          setDetectorModel('OFFLINE')
        }
      }
    }

    loadHealth()
    const timer = window.setInterval(loadHealth, 15000)
    return ()=>{
      active = false
      window.clearInterval(timer)
    }
  }, [mode])

  const tracks = serviceDriven ? serviceState.tracks : simulatedTracks
  const currentFrame = serviceDriven ? serviceState.frame : Math.round(tick * simFps)

  useEffect(()=>{
    if (tracks.length === 0) return
    if (!tracks.some((track)=>track.id === selectedId)){
      setSelectedId(tracks[0].id)
    }
  }, [tracks, selectedId])

  useEffect(()=>{
    setConfidenceById((prev)=>{
      const next = { ...prev }
      for (const tr of tracks){
        const history = next[tr.id] || []
        next[tr.id] = [...history.slice(-7), tr.confidence]
      }
      return next
    })
  }, [tracks])

  const clusters = useMemo(()=>groupClusters(tracks), [tracks])
  const selected = useMemo(()=> tracks.find(x=>x.id===selectedId) || null, [tracks, selectedId])

  const alertCount = useMemo(()=> tracks.filter(x=> x.flags.length>0 || x.confidence<0.55).length, [tracks])

  const filtered = useMemo(()=>{
    let list = tracks
    if (search.trim()){
      const q = search.trim().toLowerCase()
      list = list.filter(x => x.callsign.toLowerCase().includes(q) || typeLabel(x.type).toLowerCase().includes(q))
    }
    if (alertsOnly){
      list = list.filter(x => x.flags.length>0 || x.confidence<0.55)
    }
    return list
  }, [tracks, search, alertsOnly])

  const overlayTracks = useMemo(()=>{
    return tracks.filter((tr)=>Array.isArray(tr.bbox) && tr.bbox.length===4).slice(0, 12)
  }, [tracks])

  useEffect(()=>{
    const canvas = overlayCanvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const dpr = window.devicePixelRatio || 1
    const width = Math.round(rect.width * dpr)
    const height = Math.round(rect.height * dpr)
    if (canvas.width !== width || canvas.height !== height){
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    const frameWidth = serviceState.frameSize.width || 640
    const frameHeight = serviceState.frameSize.height || 360
    const scaleX = rect.width / frameWidth
    const scaleY = rect.height / frameHeight

    for (const tr of overlayTracks){
      const [x, y, wBox, hBox] = tr.bbox
      const left = x * scaleX
      const top = y * scaleY
      const boxWidth = wBox * scaleX
      const boxHeight = hBox * scaleY
      const selected = tr.id === selectedId

      ctx.lineWidth = selected ? 2 : 1.5
      ctx.strokeStyle = selected ? 'rgba(34,197,94,0.98)' : 'rgba(56,189,248,0.95)'
      ctx.fillStyle = selected ? 'rgba(34,197,94,0.14)' : 'rgba(56,189,248,0.12)'
      ctx.strokeRect(left, top, boxWidth, boxHeight)
      ctx.fillRect(left, top, boxWidth, boxHeight)

      const label = `${tr.callsign} ${fmt(tr.confidence, 2)}`
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
      const textWidth = ctx.measureText(label).width
      const labelY = Math.max(18, top - 8)
      ctx.fillStyle = 'rgba(7,10,16,0.88)'
      ctx.fillRect(left, labelY - 14, textWidth + 12, 18)
      ctx.fillStyle = 'rgba(234,242,255,0.96)'
      ctx.fillText(label, left + 6, labelY)
    }
  }, [overlayTracks, selectedId, serviceState.frameSize.width, serviceState.frameSize.height])

  const logRows = useMemo(()=>{
    if (timeline.length > 0) return timeline

    return [
      { id: 'default-1', kind: 'info', ts: nowTS(), msg: `Mode: ${serviceDriven ? `${serviceState.channel.toUpperCase()} service` : 'simulation fallback'} • ${serviceState.message}` },
      { id: 'default-2', kind: 'info', ts: nowTS(), msg: `Track picture: ${tracks.length} active • ${alertCount} flagged` },
      { id: 'default-3', kind: 'info', ts: nowTS(), msg: 'JSON contract: { frame, track_id, bbox:[x,y,w,h], conf }' },
    ]
  }, [timeline, tracks, alertCount, serviceDriven, serviceState.channel, serviceState.message])

  const toggleDetector = async ()=>{
    if (mode === 'sim' || detectorBusy) return

    const nextDetector = detectorModel === 'YOLO' ? 'overlay' : 'yolo'
    setDetectorBusy(true)

    try {
      const response = await fetch(CV_DETECTOR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(CV_API_KEY ? { 'x-api-key': CV_API_KEY } : {}),
        },
        body: JSON.stringify({ detector: nextDetector }),
      })

      const payload = await response.json().catch(()=>({}))
      if (!response.ok){
        throw new Error(payload.detail || 'Detector switch failed')
      }

      setDetectorModel(detectorLabel(payload.detector))
      setTimeline((prev)=>[
        makeTimelineEntry('info', `Detector request accepted: ${detectorLabel(payload.detector)}.`),
        ...prev,
      ].slice(0, 24))
    } catch (error) {
      setTimeline((prev)=>[
        makeTimelineEntry('bad', error instanceof Error ? error.message : 'Detector switch failed.'),
        ...prev,
      ].slice(0, 24))
    } finally {
      setDetectorBusy(false)
    }
  }

  const exportReport = ()=>{
    const report = {
      generated_at: new Date().toISOString(),
      mode,
      frame: currentFrame,
      service: serviceState,
      summary: {
        tracks: tracks.length,
        flagged: alertCount,
        clusters: clusters.length,
      },
      selected_track: selected ? {
        id: selected.id,
        callsign: selected.callsign,
        confidence: selected.confidence,
        notes: notesById[selected.id] || '',
      } : null,
      timeline: logRows,
      audit_events: auditEvents,
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `swarm-report-frame-${currentFrame}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const rewind = ()=> setTick(v=> Math.max(0, v - (12 / simFps)))
  const stepBack = ()=> setTick(v=> Math.max(0, v - (1 / simFps)))
  const stepFwd = ()=> setTick(v=> v + (1 / simFps))
  const fastFwd = ()=> setTick(v=> v + (12 / simFps))

  const W=680, H=520
  const cx=W/2, cy=H/2
  const radius=Math.min(W,H)/2 - 28

  const ringEls = []
  for (let i=1;i<=rings;i++){
    ringEls.push(
      <circle key={i} cx={cx} cy={cy} r={(radius*i)/rings} className="ring" />
    )
  }

  const videoModule = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">
          <div className="t">Video Feed</div>
        </div>
        <div className="kpi">
          <button className={`pill pillToggle ${hudEnabled ? 'active' : ''}`} onClick={()=>setHudEnabled((value)=>!value)}>
            HUD: {hudEnabled ? 'ON' : 'OFF'}
          </button>
          <span>{serviceDriven ? `${serviceState.channel.toUpperCase()} stream active` : 'Simulation mode'}</span>
        </div>
      </div>

      <div className="panelBody">
        <div className={focusMode ? 'focusVideoSlot' : undefined}>
          <div className="videoBox" style={focusVideoBoxStyle}>
          <div className="videoStage">
            {serviceDriven && !videoLoadError ? (
              <img
                className="videoFeed"
                src={liveFrameUrl}
                alt="Processed frame"
                onError={()=>setVideoLoadError(true)}
              />
            ) : !serviceDriven && !videoLoadError ? (
              <video
                ref={videoRef}
                className="videoFeed"
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="auto"
                onLoadedMetadata={(event)=>{
                  setVideoReady(true)
                  setVideoLoadError(false)
                  setTick(event.currentTarget.currentTime || 0)
                }}
                onError={()=>{
                  setVideoReady(false)
                  setVideoLoadError(true)
                }}
                onTimeUpdate={(event)=>{
                  if (playing){
                    setTick(event.currentTarget.currentTime || 0)
                  }
                }}
              >
                <source src={CV_VIDEO_URL} type="video/mp4" />
                <source src={DVIDS_MP4_URL} type="video/mp4" />
                {DVIDS_HLS_URL ? <source src={DVIDS_HLS_URL} type="application/vnd.apple.mpegurl" /> : null}
              </video>
            ) : (
              <div className="videoFallback">
                <div className="videoFallbackLabel">PERDIX DEMO UNAVAILABLE</div>
                <div className="videoFallbackMeta">
                  {serviceDriven ? 'Frame endpoint unavailable' : 'Neither local MP4 nor DVIDS fallback loaded'}
                </div>
              </div>
            )}
            <div className="gridNoise" />
            {showOverlayCanvas ? <canvas ref={overlayCanvasRef} className="overlayCanvas" /> : null}
            {showVideoHud ? (
              <div className="hud">
                <div className="tag tagTL"><b>HUD</b> • IDs • Conf • Flags</div>
                <div className="tag tagTR"><b>SERVICE</b> • {serviceState.status.toUpperCase()}</div>
                <div className="tag tagBL"><b>SOURCE</b> • DVIDS • Perdix demo</div>
              </div>
            ) : null}
          </div>
        </div>
        </div>

        <div className="controlsRow">
          <button className="btn primary" disabled={playbackDisabled} onClick={()=>setPlaying(p=>!p)}>{playing ? 'Pause' : 'Play'}</button>
          <button className="btn" disabled={playbackDisabled} onClick={stepBack}>Step -1</button>
          <button className="btn" disabled={playbackDisabled} onClick={stepFwd}>Step +1</button>
          <button className="btn" disabled={playbackDisabled} onClick={rewind}>-12</button>
          <button className="btn" disabled={playbackDisabled} onClick={fastFwd}>+12</button>

          <select className="select" disabled={playbackDisabled} value={speed} onChange={(e)=>setSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>

          <div className="small">
            {serviceDriven
              ? `${serviceState.channel === 'replay' ? 'Replay' : 'Live'} CV frame feed • T+ ${fmt(serviceState.playbackSeconds, 2)}s`
              : `Playback • T+ ${fmt(tick, 2)}s`}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <input className="range" disabled={playbackDisabled} type="range" min="0" max="600" step={1 / simFps} value={tick} onChange={(e)=>setTick(Number(e.target.value))} />
          <div className="small">
            {serviceDriven
              ? `${serviceState.channel === 'replay' ? 'Replay engine clock' : 'Live pipeline'} • service-driven frames are authoritative`
              : 'Timeline scrub • deterministic simulation fallback'}
          </div>
        </div>
      </div>
    </div>
  )

  const radarModule = (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">
          <div className="t">Radar / Tactical Picture</div>
        </div>
        <div className="kpi">
          <span>Rings: {rings}</span>
          <span>Clusters: {clusters.length}</span>
          <span>Selected: {selected ? selected.callsign : '—'}</span>
        </div>
      </div>

      <div className="panelBody" style={{ overflow:'hidden' }}>
        <div className="radarWrap">
          <svg className="radarSvg" viewBox={`0 0 ${W} ${H}`}>
            <circle cx={cx} cy={cy} r={radius} stroke="rgba(255,255,255,.22)" fill="none" />
            {ringEls.map((el, idx)=>{
              return (
                <circle key={idx} cx={cx} cy={cy} r={(radius*(idx+1))/rings} stroke="rgba(255,255,255,.10)" fill="none" strokeDasharray={idx+1===rings ? "0" : "3 7"} />
              )
            })}
            <line x1="20" y1={cy} x2={W-20} y2={cy} stroke="rgba(255,255,255,.07)" />
            <line x1={cx} y1="20" x2={cx} y2={H-20} stroke="rgba(255,255,255,.07)" />

            <path d={`M ${cx} ${cy} L ${cx} ${cy-radius} A ${radius} ${radius} 0 0 1 ${cx + radius*0.35} ${cy - radius*0.94} Z`}
                  fill="rgba(34,197,94,.10)" />

            {tracks.map(tr=>{
              const p = polarToXY(cx, cy, radius, tr.bearing, tr.range_u)
              const isSel = tr.id===selectedId
              const s = isSel ? 7 : 5
              const alpha = clamp(tr.confidence, 0.35, 0.95)
              const vLen = showVectors ? (18 + tr.rel_speed_u*0.7) : 0
              const v = polarToXY(p.x, p.y, vLen, tr.heading, 1)

              const color = tr.flags.includes('LOST') ? 'rgba(239,68,68,.95)'
                          : tr.flags.includes('OCCLUDED') ? 'rgba(245,158,11,.95)'
                          : 'rgba(34,197,94,.95)'

              return (
                <g key={tr.id} style={{ cursor:'pointer' }} onClick={()=>setSelectedId(tr.id)}>
                  {showVectors ? (
                    <line x1={p.x} y1={p.y} x2={v.x} y2={v.y}
                          stroke={isSel ? 'rgba(56,189,248,.95)' : 'rgba(255,255,255,.22)'} strokeWidth={isSel ? 2 : 1} />
                  ) : null}
                  <circle cx={p.x} cy={p.y} r={s} fill={color} opacity={alpha} />
                  <circle cx={p.x} cy={p.y} r={s+12} fill={color} opacity={isSel ? 0.08 : 0.03} />
                  <text x={p.x+10} y={p.y-10} fontSize="11" fill={isSel ? 'rgba(56,189,248,.95)' : 'rgba(159,178,209,.9)'}>
                    {tr.callsign}
                  </text>
                </g>
              )
            })}

            <circle cx={cx} cy={cy} r="4" fill="rgba(34,197,94,.95)" />
          </svg>

          <div className="legendRow">
            <div className="legend"><span className="swatch"></span> Normal</div>
            <div className="legend"><span className="swatch3"></span> Occluded / low conf</div>
            <div className="legend"><span className="swatch2"></span> Selected vector</div>
            <div className="legend">Altitude shown as <b style={{ marginLeft: 6, fontFamily:'var(--mono)' }}>LOW/MED/HIGH</b> (inferred)</div>
          </div>

          <div style={{ display:'flex', gap:10, marginTop:10, width:'100%', alignItems:'center', justifyContent:'space-between' }}>
            <div className="small">Display</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button className="btn" onClick={()=>setRings(r=>clamp(r-1,3,7))}>- Ring</button>
              <button className="btn" onClick={()=>setRings(r=>clamp(r+1,3,7))}>+ Ring</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (focusMode){
    return (
      <div className="focusShell">
        <div className="focusBar">
          <div className="focusTitle">Presentation View</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className={`btn ${detectorBusy ? 'active' : ''}`} disabled={mode === 'sim' || detectorBusy} onClick={toggleDetector}>
              Detector: {detectorBusy ? 'SWITCHING…' : detectorModel}
            </button>
            <button className="btn primary" onClick={()=>setFocusMode(false)}>Return To Full Console</button>
          </div>
        </div>
        <div
          ref={focusStackRef}
          className="focusStack"
          style={{ gridTemplateRows: `${focusTopHeight}px ${splitterSize}px minmax(${minFocusBottomPane}px, 1fr)` }}
        >
          <div className="focusPanel">{videoModule}</div>
          <div
            className="paneResizer horizontal focusResizer"
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={(event)=>startResize('focus', event)}
          />
          <div className="focusPanel">{radarModule}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="shell"
      style={{ gridTemplateRows: `64px minmax(0, 1fr) ${splitterSize}px ${bottomPaneHeight}px` }}
    >
      <div className="topbar">
        <div className="brand">
          <div className="logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2v4" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M4.93 4.93l2.83 2.83" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M2 12h4" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M4.93 19.07l2.83-2.83" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M12 18v4" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M19.07 19.07l-2.83-2.83" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M18 12h4" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M19.07 4.93l-2.83 2.83" stroke="rgba(234,242,255,.9)" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="12" r="4" stroke="rgba(34,197,94,.9)" strokeWidth="2"/>
            </svg>
          </div>
          <div>
            <h1>JROTC Swarm Tactical Console</h1>
            <div className="sub">2026 layout • ATAK-inspired • Week 3 CV microservice integration</div>
          </div>
        </div>

        <div className="pills">
          <div className="pill"><span className="dot" /> AI <b>{serviceDriven ? serviceState.channel.toUpperCase() : mode.toUpperCase()}</b></div>
          <div className="pill">Tracks <b>{tracks.length}</b></div>
          <div className="pill">Flagged <b>{alertCount}</b></div>
          <div className="pill">Mode <b>{mode.toUpperCase()}</b></div>
          <div className="pill">Frame <b>{currentFrame}</b></div>
          <div className="pill">Service <b>{serviceState.status.toUpperCase()}</b></div>
        </div>

        <div className="actions">
          <button className={`btn ${mode === 'live' ? 'active' : ''}`} onClick={()=>setMode('live')}>AI: LIVE</button>
          <button className={`btn ${mode === 'replay' ? 'active' : ''}`} onClick={()=>setMode('replay')}>AI: REPLAY</button>
          <button className={`btn ${mode === 'sim' ? 'active' : ''}`} onClick={()=>setMode('sim')}>AI: SIM</button>
          <button className={`btn ${detectorBusy ? 'active' : ''}`} disabled={mode === 'sim' || detectorBusy} onClick={toggleDetector}>
            Detector: {detectorBusy ? 'SWITCHING…' : detectorModel}
          </button>
          <button className="btn" onClick={()=>setFocusMode(true)}>Video + Radar Only</button>
          <button className="btn" onClick={()=>setShowVectors(v=>!v)}>{showVectors ? 'Vectors: ON' : 'Vectors: OFF'}</button>
          <button className="btn" onClick={()=>setAlertsOnly(v=>!v)}>{alertsOnly ? 'Alerts: ON' : 'Alerts: OFF'}</button>
          <button className="btn primary" onClick={()=>setPlaying(p=>!p)}>{playing ? 'Pause' : 'Play'}</button>
          <button className="btn" onClick={rewind}>⟲ Rewind</button>
          <button className="btn" onClick={fastFwd}>Fast ⟳</button>
          <button className="btn" onClick={exportReport}>Export Report</button>
        </div>
      </div>

      <div
        ref={midRef}
        className="mid midResizable"
        style={{
          gridTemplateColumns: `${leftPaneWidth}px ${splitterSize}px ${centerPaneWidth}px ${splitterSize}px minmax(${minRightPane}px, 1fr)`,
        }}
      >
        {videoModule}
        <div
          className="paneResizer vertical"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(event)=>startResize('left', event)}
        />
        {radarModule}
        <div
          className="paneResizer vertical"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(event)=>startResize('center', event)}
        />

        {/* RIGHT: Inspector + table */}
        <div className="panel">
        <div className="panelHeader">
          <div className="panelTitle">
            <div className="t">Track Inspector</div>
          </div>
          <div className="kpi"><span>Integrity: ON</span></div>
        </div>

          <div className="panelBody">
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input
                className="select"
                style={{ flex:1 }}
                placeholder="Search callsign or type…"
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
              />
              <button className="btn" onClick={()=>setAlertsOnly(v=>!v)}>{alertsOnly ? 'Alerts only' : 'All tracks'}</button>
            </div>

            <div style={{ marginTop: 10 }}>
              {selected ? (
                <>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                    <div style={{ fontSize:16, fontWeight:750 }}>{selected.callsign}</div>
                    <span className={`badge ${sev(selected)}`}>
                      <span className="m">{typeLabel(selected.type)}</span>
                    </span>
                  </div>

                  <div className="inspectorGrid" style={{ marginTop: 10 }}>
                    <div className="cardMini"><div className="k">Bearing</div><div className="v">{fmt(selected.bearing,0)}°</div></div>
                    <div className="cardMini"><div className="k">Range</div><div className="v">{fmt(selected.range_u,2)} u</div></div>
                    <div className="cardMini"><div className="k">Heading</div><div className="v">{fmt(selected.heading,0)}°</div></div>
                    <div className="cardMini"><div className="k">Rel Speed</div><div className="v">{fmt(selected.rel_speed_u,0)} u/s</div></div>
                    <div className="cardMini"><div className="k">Altitude Band</div><div className="v">{selected.alt_band}</div></div>
                    <div className="cardMini"><div className="k">Confidence</div><div className="v">{fmt(selected.confidence,2)}</div></div>
                  </div>

                  <div className="notes" style={{ marginTop: 10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ fontSize:12, fontWeight:700 }}>Confidence Trend</div>
                      <div className="small">{confidenceTrend(confidenceById[selected.id]).toUpperCase()}</div>
                    </div>
                    <div style={{ marginTop: 8 }} className="trendCard">
                      <svg viewBox="0 0 64 18" className="spark">
                        <path d={sparkPath(confidenceById[selected.id])} />
                      </svg>
                    </div>
                  </div>

                  <div className="notes">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ fontSize:12, fontWeight:700 }}>Commander Notes</div>
                      <div className="small">Saved locally (prototype)</div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={notesById[selected.id] || ''}
                        onChange={(e)=> setNotesById(n => ({...n, [selected.id]: e.target.value}))}
                        placeholder="Observations, anomalies, cluster notes, confidence issues, cadet tasking…"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="small">Select a track on the radar or table.</div>
              )}
            </div>

            <div style={{ marginTop: 12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:12, fontWeight:750 }}>Track List</div>
              <div className="small">{filtered.length} shown</div>
            </div>

            <div style={{ marginTop: 8, maxHeight: 260, overflow:'auto', borderRadius: 18, border:'1px solid rgba(255,255,255,.10)', background:'rgba(0,0,0,.10)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Callsign</th>
                    <th>Conf</th>
                    <th>Trend</th>
                    <th>Bear</th>
                    <th>Alt</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tr=>{
                    const isSel = tr.id===selectedId
                    const bClass = sev(tr)
                    const trend = confidenceTrend(confidenceById[tr.id])
                    return (
                      <tr key={tr.id} onClick={()=>setSelectedId(tr.id)} style={{ background: isSel ? 'rgba(56,189,248,.08)' : undefined }}>
                        <td style={{ fontWeight:650 }}>{tr.callsign}</td>
                        <td><span className={`badge ${bClass}`}><span className="m">{fmt(tr.confidence,2)}</span></span></td>
                        <td>
                          <div className={`trend ${trend}`}>
                            <svg viewBox="0 0 64 18" className="spark">
                              <path d={sparkPath(confidenceById[tr.id])} />
                            </svg>
                          </div>
                        </td>
                        <td style={{ fontFamily:'var(--mono)' }}>{fmt(tr.bearing,0)}°</td>
                        <td><span className="badge">{tr.alt_band}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>

      <div
        className="paneResizer horizontal shellDivider"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={(event)=>startResize('bottom', event)}
      />

      <div className="bottom">
        <div className="log">
          {logRows.map((r, idx)=> (
            <div key={r.id ?? idx} className={`logRow ${r.kind ? `kind-${r.kind}` : ''}`}>
              <div className="ts">{r.ts}</div>
              <div className="msg">{r.msg}</div>
            </div>
          ))}
        </div>

        <div className="rightMini">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:800 }}>Operational Snapshot</div>
            <div className="small">Training mode</div>
          </div>
          <div className="miniKpis">
            <div className="k"><div className="l">Tracks</div><div className="n">{tracks.length}</div></div>
            <div className="k"><div className="l">Flagged</div><div className="n">{alertCount}</div></div>
            <div className="k"><div className="l">Clusters</div><div className="n">{clusters.length}</div></div>
          </div>

          <div style={{ marginTop: 10 }} className="small">
            UX pillars: calm legibility • commander truthfulness • plug-and-play CV service • export-ready timeline.
          </div>

          <div className="auditPanel">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:800 }}>Audit Feed</div>
              <div className="small">{mode === 'sim' ? 'offline' : `${auditEvents.length} entries`}</div>
            </div>
            <div className="auditList">
              {auditEvents.length === 0 ? (
                <div className="small">No recent audit events available.</div>
              ) : auditEvents.map((entry, index)=>(
                <div key={`${index}-${entry}`} className="auditRow">{entry}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
