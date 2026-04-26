import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'
import './App.css'
import { apiService } from './services/api'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'
const CATEGORY_TAGS = ['Ăn & Uống', 'Chỗ ở', 'Mua sắm', 'Giải trí & Thư giãn']
const VEHICLES = [
  { key: 'car', icon: 'fa-solid fa-car' },
  { key: 'bike', icon: 'fa-solid fa-bicycle' },
  { key: 'foot', icon: 'fa-solid fa-person-walking' },
  { key: 'motorcycle', icon: 'fa-solid fa-motorcycle' },
]

function toLngLat(point) {
  if (!Array.isArray(point) || point.length < 2) return null
  const first = Number(point[0])
  const second = Number(point[1])
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [second, first]
  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) return [first, second]
  return null
}

function extractCoordinates(points) {
  if (Array.isArray(points)) return points.map(toLngLat).filter(Boolean)
  if (Array.isArray(points?.coordinates)) return points.coordinates.map(toLngLat).filter(Boolean)
  return []
}

export default function App() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const placeMarkerRef = useRef(null)
  const startMarkerRef = useRef(null)
  const endMarkerRef = useRef(null)
  const routeActionRef = useRef(null)

  const apiKey = useMemo(() => import.meta.env.VITE_VIETMAP_API_KEY || '', [])
  const styleUrl = useMemo(
    () => `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${apiKey}`,
    [apiKey],
  )

  const [mode, setMode] = useState('browse')
  const [focusedInput, setFocusedInput] = useState('search')
  const [isSuggestOpen, setIsSuggestOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [startQuery, setStartQuery] = useState('')
  const [endQuery, setEndQuery] = useState('')
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [selectedStart, setSelectedStart] = useState(null)
  const [selectedEnd, setSelectedEnd] = useState(null)
  const [vehicle, setVehicle] = useState('car')
  const [suggestions, setSuggestions] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [isRouting, setIsRouting] = useState(false)
  const [routeInfo, setRouteInfo] = useState(null)
  const [instructions, setInstructions] = useState([])
  const [tolls, setTolls] = useState([])
  const [showSteps, setShowSteps] = useState(false)
  const [error, setError] = useState('')

  const tollTotal = useMemo(
    () => tolls.reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0),
    [tolls],
  )

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = new vietmapgl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: 14,
    })
    mapRef.current = map

    // Controls: Navigation, Geolocate, Scale, Fullscreen
    // Navigation (zoom + compass) top-right
    map.addControl(
      new vietmapgl.NavigationControl({
        showZoom: true,
        showCompass: true,
      }),
      'top-right',
    )

    // Geolocate (user position) top-right
    map.addControl(
      new vietmapgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }),
      'top-right',
    )

    // Scale control bottom-left
    map.addControl(
      new vietmapgl.ScaleControl({
        maxWidth: 100,
        unit: 'metric',
      }),
      'bottom-left',
    )

    // Fullscreen control top-right
    map.addControl(new vietmapgl.FullscreenControl(), 'top-right')

    return () => {
      if (placeMarkerRef.current) placeMarkerRef.current.remove()
      if (startMarkerRef.current) startMarkerRef.current.remove()
      if (endMarkerRef.current) endMarkerRef.current.remove()
      map.remove()
      mapRef.current = null
    }
  }, [styleUrl])

  useEffect(() => {
    if (!apiKey || !isSuggestOpen || !focusedInput) return
    const query =
      focusedInput === 'search' ? searchQuery.trim() : focusedInput === 'start' ? startQuery.trim() : endQuery.trim()

    if (query.length < 2) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        setIsSearching(true)
        const center = mapRef.current?.getCenter()
        const focus = center ? `${center.lat},${center.lng}` : `${DEFAULT_CENTER[1]},${DEFAULT_CENTER[0]}`

        const data = await apiService.searchAutocomplete(query, focus, apiKey)
        if (!controller.signal.aborted) {
          setSuggestions(data)
        }
      } catch (err) {
        if (err.name !== 'AbortError') setSuggestions([])
      } finally {
        if (!controller.signal.aborted) setIsSearching(false)
      }
    }, 280)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [apiKey, endQuery, focusedInput, isSuggestOpen, searchQuery, startQuery])

  const removeRouteLayer = () => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID)
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID)
  }

  const setMarker = (refObj, lngLat, color) => {
    const map = mapRef.current
    if (!map) return
    if (!refObj.current) {
      refObj.current = new vietmapgl.Marker({ color }).setLngLat(lngLat).addTo(map)
    } else {
      refObj.current.setLngLat(lngLat)
    }
  }

  const drawRoute = (coordinates) => {
    const map = mapRef.current
    if (!map || coordinates.length < 2) return
    removeRouteLayer()
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates } },
    })
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2f64ff', 'line-width': 6 },
    })

    const bounds = coordinates.reduce(
      (acc, coord) => acc.extend(coord),
      new vietmapgl.LngLatBounds(coordinates[0], coordinates[0]),
    )
    map.fitBounds(bounds, { padding: 80, duration: 450 })
  }

  const handleSelectSuggestion = async (item) => {
    if (!item?.ref_id || !apiKey) return
    try {
      setError('')
      const place = await apiService.getPlaceDetail(item.ref_id, apiKey)
      const lngLat = [place.lng, place.lat]

      if (focusedInput === 'search') {
        setSelectedPlace(place)
        setSearchQuery(place.display)
        setMarker(placeMarkerRef, lngLat, '#ef4444')
      } else if (focusedInput === 'start') {
        setSelectedStart(place)
        setStartQuery(place.display)
        setMarker(startMarkerRef, lngLat, '#1d4ed8')
      } else {
        setSelectedEnd(place)
        setEndQuery(place.display)
        setMarker(endMarkerRef, lngLat, '#ef4444')
      }

      mapRef.current?.flyTo({ center: lngLat, zoom: 16, essential: true })
      setSuggestions([])
      setIsSuggestOpen(false)
      setFocusedInput(null)
      setRouteInfo(null)
      setInstructions([])
      setShowSteps(false)
      removeRouteLayer()
    } catch (err) {
      setError(err.message || 'Không thể chọn địa điểm.')
    }
  }

  const handleOpenDirection = useCallback(async () => {
    setMode('route')
    setFocusedInput('start')
    setIsSuggestOpen(false)
    setSuggestions([])

    if (selectedPlace) {
      setSelectedEnd(selectedPlace)
      setEndQuery(selectedPlace.display)
    }
  }, [selectedPlace])

  useEffect(() => {
    routeActionRef.current = handleOpenDirection
  }, [handleOpenDirection])



  const handleSwap = () => {
    setStartQuery(endQuery)
    setEndQuery(startQuery)
    setSelectedStart(selectedEnd)
    setSelectedEnd(selectedStart)
  }

  const fetchRoute = async () => {
    if (!selectedStart || !selectedEnd) {
      setRouteInfo(null)
      setInstructions([])
      setTolls([])
      removeRouteLayer()
      return
    }

    try {
      setIsRouting(true)
      setError('')

      const routeData = await apiService.getRoute(
        selectedStart.lat,
        selectedStart.lng,
        selectedEnd.lat,
        selectedEnd.lng,
        vehicle,
        apiKey,
      )

      const coordinates = extractCoordinates(routeData.points)
      if (coordinates.length < 2) throw new Error('Dữ liệu tuyến đường không hợp lệ.')

      drawRoute(coordinates)
      setRouteInfo({
        distanceKm: (routeData.distance / 1000).toFixed(2),
        durationMin: Math.round(routeData.time / 60000),
      })
      setInstructions(routeData.instructions)

      // Lấy phí cao tốc nếu là ô tô
      if (vehicle === 'car') {
        const tollList = await apiService.getRouteTolls(
          selectedStart.lng,
          selectedStart.lat,
          selectedEnd.lng,
          selectedEnd.lat,
          apiKey,
        )
        setTolls(tollList)
      } else {
        setTolls([])
      }

      setShowSteps(false)
      setIsSuggestOpen(false)
    } catch (err) {
      setError(err.message || 'Không thể tìm đường.')
      setRouteInfo(null)
      setInstructions([])
      setTolls([])
    } finally {
      setIsRouting(false)
    }
  }

  const handleStopDirection = () => {
    const destination = selectedEnd || selectedPlace
    setMode('browse')
    setFocusedInput('search')
    setIsSuggestOpen(false)
    setSuggestions([])
    setRouteInfo(null)
    setInstructions([])
    setTolls([])
    setShowSteps(false)
    setSelectedStart(null)
    setSelectedEnd(null)
    setStartQuery('')
    setEndQuery('')
    removeRouteLayer()

    if (startMarkerRef.current) {
      startMarkerRef.current.remove()
      startMarkerRef.current = null
    }
    if (endMarkerRef.current) {
      endMarkerRef.current.remove()
      endMarkerRef.current = null
    }

    if (destination) {
      setSelectedPlace(destination)
      setSearchQuery(destination.display || '')
      setMarker(placeMarkerRef, [destination.lng, destination.lat], '#ef4444')
    }
  }

  useEffect(() => {
    if (mode !== 'route') return

    const timeout = setTimeout(() => {
      fetchRoute()
    }, 250)

    return () => clearTimeout(timeout)
  }, [mode, selectedStart, selectedEnd, vehicle])

  return (
    <div className="screen">
      <div ref={mapContainerRef} className="map" />

      {!apiKey && <div className="floating-error">Thiếu VITE_VIETMAP_API_KEY trong .env.</div>}
      {error && <div className="floating-error second">{error}</div>}

      {mode === 'browse' && (
        <div className="top-search">
          <input
            value={searchQuery}
            onFocus={() => setFocusedInput('search')}
            onChange={(e) => {
              setFocusedInput('search')
              setSearchQuery(e.target.value)
              setSelectedPlace(null)
              setIsSuggestOpen(true)
            }}
            placeholder="Nhập từ khoá để tìm kiếm"
          />
          <div className="chips">
            {CATEGORY_TAGS.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          {isSearching && <p className="hint">Đang tải gợi ý...</p>}
          {isSuggestOpen && focusedInput === 'search' && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((item) => (
                <li key={item.ref_id}>
                  <button type="button" onClick={() => handleSelectSuggestion(item)}>
                    <strong>{item.name || item.display}</strong>
                    <span>{item.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'browse' && (
        <button
          type="button"
          className="floating-route-btn"
          onClick={handleOpenDirection}
          title="Tìm đường 2 điểm"
        >
          <i className="fa-solid fa-route" aria-hidden="true" />
        </button>
      )}

      {mode === 'route' && (
        <div className="route-header">
          <div className="route-inputs">
            <input
              value={startQuery}
              className="route-start-input"
              onFocus={() => {
                setFocusedInput('start')
                setIsSuggestOpen(true)
              }}
              onChange={(e) => {
                setFocusedInput('start')
                setStartQuery(e.target.value)
                setSelectedStart(null)
                setIsSuggestOpen(true)
              }}
              placeholder="Vị trí của bạn"
            />
            <input
              value={endQuery}
              className="route-end-input"
              onFocus={() => {
                setFocusedInput('end')
                setIsSuggestOpen(true)
              }}
              onChange={(e) => {
                setFocusedInput('end')
                setEndQuery(e.target.value)
                setSelectedEnd(null)
                setIsSuggestOpen(true)
              }}
              placeholder="Nhập điểm đến"
            />
            <button type="button" className="swap-btn" onClick={handleSwap}>
              <i className="fa-solid fa-arrow-up-arrow-down" aria-hidden="true" />
            </button>
          </div>

          <div className="vehicle-tabs">
            {VEHICLES.map((item) => (
              <button
                key={item.key}
                className={item.key === vehicle ? 'active' : ''}
                type="button"
                onClick={() => setVehicle(item.key)}
              >
                <i className={item.icon} aria-hidden="true" />
              </button>
            ))}
          </div>

          {isRouting && <p className="hint">Đang tự động tìm tuyến đường...</p>}

          {isSuggestOpen && (focusedInput === 'start' || focusedInput === 'end') && suggestions.length > 0 && (
            <ul className="suggestions in-route">
              {suggestions.map((item) => (
                <li key={`${focusedInput}-${item.ref_id}`}>
                  <button type="button" onClick={() => handleSelectSuggestion(item)}>
                    <strong>{item.name || item.display}</strong>
                    <span>{item.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'browse' && selectedPlace && (
        <div className="bottom-card">
          <h3>{selectedPlace.display}</h3>
          <p>{selectedPlace.address}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={handleOpenDirection}>
              Chỉ đường
            </button>
            <button type="button">Bắt đầu</button>
          </div>
        </div>
      )}

      {mode === 'route' && routeInfo && (
        <div className="bottom-card route-info">
          <h3>
            {routeInfo.durationMin} phút <span>({routeInfo.distanceKm} km)</span>
          </h3>
          <p>Tuyến đường tốt nhất</p>
          {vehicle === 'car' && (
            <p className="toll-summary">
              Phí cao tốc:{' '}
              <strong>{tollTotal > 0 ? `${tollTotal.toLocaleString('vi-VN')} đ` : 'Chưa có dữ liệu phí'}</strong>
            </p>
          )}
          <div className="actions">
            <button type="button" onClick={() => setShowSteps((prev) => !prev)}>
              {showSteps ? 'Ẩn chặng' : 'Các chặng'}
            </button>
            <button type="button" className="primary" onClick={handleStopDirection}>
              Tắt tìm đường
            </button>
          </div>
          {showSteps && (
            <div className="steps">
              {vehicle === 'car' && tolls.length > 0 && (
                <div className="step toll-step">
                  <strong>Các trạm thu phí</strong>
                  {tolls.map((item, idx) => (
                    <span key={`${item?.name || 'toll'}-${idx}`}>
                      {item?.name}: {Number(item?.amount || 0).toLocaleString('vi-VN')} đ
                    </span>
                  ))}
                </div>
              )}
              {instructions.slice(0, 8).map((step, index) => (
                <div key={`${index}-${step?.text || ''}`} className="step">
                  <strong>{step?.text || 'Đi tiếp'}</strong>
                  <span>{Math.max(0, Math.round(step?.distance || 0))} m</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
