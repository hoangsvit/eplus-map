import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'
import './App.css'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'
const CATEGORY_TAGS = ['Ăn & Uống', 'Chỗ ở', 'Mua sắm', 'Giải trí & Thư giãn']
const VEHICLES = [
  { key: 'car', label: '🚗' },
  { key: 'bike', label: '🚲' },
  { key: 'foot', label: '🚶' },
  { key: 'motorcycle', label: '🏍️' },
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
        const params = new URLSearchParams({
          apikey: apiKey,
          text: query,
          focus,
          display_type: '5',
        })

        const response = await fetch(`https://maps.vietmap.vn/api/autocomplete/v4?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Không thể tải gợi ý.')
        const data = await response.json()
        setSuggestions(Array.isArray(data) ? data : [])
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

  const fetchPlaceByRefId = async (refId) => {
    const params = new URLSearchParams({ apikey: apiKey, refid: refId })
    const response = await fetch(`https://maps.vietmap.vn/api/place/v4?${params.toString()}`)
    if (!response.ok) throw new Error('Không lấy được chi tiết địa điểm.')
    const place = await response.json()
    if (typeof place?.lat !== 'number' || typeof place?.lng !== 'number') {
      throw new Error('Địa điểm không có tọa độ hợp lệ.')
    }
    return {
      lat: place.lat,
      lng: place.lng,
      display: place.display || place.name || '',
      address: place.address || '',
    }
  }

  const handleSelectSuggestion = async (item) => {
    if (!item?.ref_id || !apiKey) return
    try {
      setError('')
      const place = await fetchPlaceByRefId(item.ref_id)
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

  const handleOpenDirection = async () => {
    setMode('route')
    setFocusedInput('start')
    setIsSuggestOpen(false)
    setSuggestions([])

    if (selectedPlace) {
      setSelectedEnd(selectedPlace)
      setEndQuery(selectedPlace.display)
    }

    if (selectedStart) return
    handleUseCurrentLocation()
  }

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Thiết bị không hỗ trợ định vị GPS.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const place = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          display: 'Vị trí hiện tại',
          address: '',
        }
        setSelectedStart(place)
        setStartQuery(place.display)
        setMarker(startMarkerRef, [place.lng, place.lat], '#1d4ed8')
        mapRef.current?.flyTo({ center: [place.lng, place.lat], zoom: 15, essential: true })
        setError('')
      },
      () => {
        setError('Không lấy được vị trí hiện tại. Vui lòng bật GPS/quyền vị trí.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

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
      const params = new URLSearchParams({
        'api-version': '1.1',
        apikey: apiKey,
        vehicle,
        points_encoded: 'false',
      })
      params.append('point', `${selectedStart.lat},${selectedStart.lng}`)
      params.append('point', `${selectedEnd.lat},${selectedEnd.lng}`)

      const response = await fetch(`https://maps.vietmap.vn/api/route?${params.toString()}`)
      if (!response.ok) throw new Error('Không gọi được Route API.')
      const data = await response.json()
      const path = data?.paths?.[0]
      if (!path) throw new Error('Không có tuyến đường phù hợp.')

      const coordinates = extractCoordinates(path.points)
      if (coordinates.length < 2) throw new Error('Dữ liệu tuyến đường không hợp lệ.')

      drawRoute(coordinates)
      setRouteInfo({
        distanceKm: (path.distance / 1000).toFixed(2),
        durationMin: Math.round(path.time / 60000),
      })
      setInstructions(Array.isArray(path.instructions) ? path.instructions : [])
      if (vehicle === 'car') {
        try {
          const tollsResponse = await fetch(
            `https://maps.vietmap.vn/api/route-tolls?api-version=1.1&apikey=${apiKey}&vehicle=1`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify([
                [selectedStart.lng, selectedStart.lat],
                [selectedEnd.lng, selectedEnd.lat],
              ]),
            },
          )
          if (tollsResponse.ok) {
            const tollData = await tollsResponse.json()
            const tollList = Array.isArray(tollData?.tolls)
              ? tollData.tolls
              : Array.isArray(tollData?.data?.tolls)
                ? tollData.data.tolls
                : []
            setTolls(tollList)
          } else {
            setTolls([])
          }
        } catch {
          // Không chặn hiển thị tuyến đường nếu API phí cao tốc lỗi tạm thời.
          setTolls([])
        }
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
              ⇅
            </button>
            <button type="button" className="gps-btn" onClick={handleUseCurrentLocation}>
              📍
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
                {item.label}
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
            <button type="button" className="primary">
              Bắt đầu
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
