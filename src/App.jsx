import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'
import './App.css'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'

function toLngLat(point) {
  if (!Array.isArray(point) || point.length < 2) return null

  const first = Number(point[0])
  const second = Number(point[1])
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null

  // VietMap Route API docs: points_encoded=false => [lat, lng].
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
    return [second, first]
  }

  // Fallback if API returns [lng, lat].
  if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
    return [first, second]
  }

  return null
}

function extractCoordinates(points) {
  if (Array.isArray(points)) {
    return points.map(toLngLat).filter(Boolean)
  }
  if (Array.isArray(points?.coordinates)) {
    return points.coordinates.map(toLngLat).filter(Boolean)
  }
  return []
}

export default function App() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const startMarkerRef = useRef(null)
  const endMarkerRef = useRef(null)

  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [activeField, setActiveField] = useState('start')
  const [suggestions, setSuggestions] = useState([])
  const [selectedStart, setSelectedStart] = useState(null)
  const [selectedEnd, setSelectedEnd] = useState(null)
  const [vehicle, setVehicle] = useState('car')
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState('')
  const [routeInfo, setRouteInfo] = useState(null)
  const [instructions, setInstructions] = useState([])

  const apiKey = useMemo(() => import.meta.env.VITE_VIETMAP_API_KEY || '', [])
  const styleUrl = useMemo(
    () => `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${apiKey}`,
    [apiKey],
  )

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new vietmapgl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: 12,
    })

    map.addControl(new vietmapgl.NavigationControl(), 'top-right')
    mapRef.current = map

    return () => {
      if (startMarkerRef.current) startMarkerRef.current.remove()
      if (endMarkerRef.current) endMarkerRef.current.remove()
      map.remove()
      mapRef.current = null
    }
  }, [styleUrl])

  useEffect(() => {
    if (!apiKey) {
      setSuggestions([])
      return
    }

    const searchText = (activeField === 'start' ? startInput : endInput).trim()
    if (searchText.length < 2) {
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
          text: searchText,
          focus,
          display_type: '5',
        })

        const response = await fetch(`https://maps.vietmap.vn/api/autocomplete/v4?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Không tải được gợi ý tìm kiếm.')
        }
        const data = await response.json()
        setSuggestions(Array.isArray(data) ? data : [])
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSuggestions([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      }
    }, 300)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [activeField, apiKey, endInput, startInput])

  const removeRouteLayer = () => {
    const map = mapRef.current
    if (!map) return

    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.removeLayer(ROUTE_LAYER_ID)
    }
    if (map.getSource(ROUTE_SOURCE_ID)) {
      map.removeSource(ROUTE_SOURCE_ID)
    }
  }

  const drawRoute = (coordinates) => {
    const map = mapRef.current
    if (!map || coordinates.length < 2) return

    removeRouteLayer()

    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    })

    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1d4ed8', 'line-width': 5 },
    })

    const bounds = coordinates.reduce(
      (acc, coord) => acc.extend(coord),
      new vietmapgl.LngLatBounds(coordinates[0], coordinates[0]),
    )
    map.fitBounds(bounds, { padding: 60, duration: 500 })
  }

  const setMarker = (markerRefObj, lngLat, color) => {
    const map = mapRef.current
    if (!map) return

    if (!markerRefObj.current) {
      markerRefObj.current = new vietmapgl.Marker({ color }).setLngLat(lngLat).addTo(map)
    } else {
      markerRefObj.current.setLngLat(lngLat)
    }
  }

  const handleSelectSuggestion = async (item, field) => {
    if (!apiKey || !item?.ref_id) return

    try {
      setError('')
      const params = new URLSearchParams({
        apikey: apiKey,
        refid: item.ref_id,
      })
      const response = await fetch(`https://maps.vietmap.vn/api/place/v4?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Không lấy được chi tiết địa điểm.')
      }

      const place = await response.json()
      if (typeof place?.lat !== 'number' || typeof place?.lng !== 'number') {
        throw new Error('Địa điểm không có tọa độ hợp lệ.')
      }

      const selected = {
        lat: place.lat,
        lng: place.lng,
        display: place.display || item.display || item.name || '',
      }

      if (field === 'start') {
        setSelectedStart(selected)
        setStartInput(selected.display)
        setMarker(startMarkerRef, [selected.lng, selected.lat], '#16a34a')
      } else {
        setSelectedEnd(selected)
        setEndInput(selected.display)
        setMarker(endMarkerRef, [selected.lng, selected.lat], '#dc2626')
      }

      mapRef.current?.flyTo({
        center: [selected.lng, selected.lat],
        zoom: 15,
        essential: true,
      })

      setSuggestions([])
      setRouteInfo(null)
      setInstructions([])
      removeRouteLayer()
    } catch (err) {
      setError(err.message || 'Không thể chọn địa điểm.')
    }
  }

  const handleFindRoute = async () => {
    if (!selectedStart || !selectedEnd) {
      setError('Vui lòng chọn đầy đủ điểm bắt đầu và điểm kết thúc từ thanh search.')
      return
    }

    setError('')
    setIsLoading(true)
    setRouteInfo(null)
    setInstructions([])

    try {
      const params = new URLSearchParams({
        'api-version': '1.1',
        apikey: apiKey,
        vehicle,
        points_encoded: 'false',
      })
      params.append('point', `${selectedStart.lat},${selectedStart.lng}`)
      params.append('point', `${selectedEnd.lat},${selectedEnd.lng}`)

      const response = await fetch(`https://maps.vietmap.vn/api/route?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Không gọi được VietMap Route API.')
      }

      const data = await response.json()
      const path = data?.paths?.[0]
      if (!path) {
        throw new Error('Không có dữ liệu paths[0] trong response.')
      }

      const coordinates = extractCoordinates(path.points)
      if (coordinates.length < 2) {
        throw new Error('Dữ liệu tuyến đường không hợp lệ (paths[0].points).')
      }

      drawRoute(coordinates)
      setMarker(startMarkerRef, [selectedStart.lng, selectedStart.lat], '#16a34a')
      setMarker(endMarkerRef, [selectedEnd.lng, selectedEnd.lat], '#dc2626')

      setRouteInfo({
        distanceKm: (path.distance / 1000).toFixed(2),
        durationMin: Math.round(path.time / 60000),
      })
      setInstructions(Array.isArray(path.instructions) ? path.instructions : [])
    } catch (err) {
      removeRouteLayer()
      setError(err.message || 'Không thể tìm đường.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <aside className="panel">
        <h1>VietMap Route Demo</h1>

        <label htmlFor="start">Điểm bắt đầu</label>
        <input
          id="start"
          value={startInput}
          onFocus={() => setActiveField('start')}
          onChange={(e) => {
            setActiveField('start')
            setStartInput(e.target.value)
            setSelectedStart(null)
          }}
          placeholder="Tìm địa chỉ/địa điểm bắt đầu..."
        />
        {activeField === 'start' && suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((item) => (
              <li key={`start-${item.ref_id}`}>
                <button type="button" onClick={() => handleSelectSuggestion(item, 'start')}>
                  <strong>{item.name || item.display}</strong>
                  <span>{item.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="end">Điểm kết thúc</label>
        <input
          id="end"
          value={endInput}
          onFocus={() => setActiveField('end')}
          onChange={(e) => {
            setActiveField('end')
            setEndInput(e.target.value)
            setSelectedEnd(null)
          }}
          placeholder="Tìm địa chỉ/địa điểm kết thúc..."
        />
        {activeField === 'end' && suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((item) => (
              <li key={`end-${item.ref_id}`}>
                <button type="button" onClick={() => handleSelectSuggestion(item, 'end')}>
                  <strong>{item.name || item.display}</strong>
                  <span>{item.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="vehicle">Phương tiện</label>
        <select id="vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
          <option value="car">car</option>
          <option value="motorcycle">motorcycle</option>
          <option value="bike">bike</option>
          <option value="foot">foot</option>
        </select>

        <button onClick={handleFindRoute} disabled={isLoading}>
          {isLoading ? 'Đang tìm...' : 'Tìm đường'}
        </button>

        {!apiKey && <p className="error">Thiếu biến môi trường VITE_VIETMAP_API_KEY.</p>}
        {isSearching && <p className="searching">Đang tải gợi ý địa điểm...</p>}
        {error && <p className="error">{error}</p>}

        {routeInfo && (
          <div className="summary">
            <p>
              <strong>Khoảng cách:</strong> {routeInfo.distanceKm} km
            </p>
            <p>
              <strong>Thời gian:</strong> {routeInfo.durationMin} phút
            </p>
          </div>
        )}

        {instructions.length > 0 && (
          <div className="instructions">
            <h2>Chỉ dẫn rẽ</h2>
            <ol>
              {instructions.map((item, index) => (
                <li key={`${index}-${item?.street_name || 'step'}`}>
                  {item?.text || item?.street_name || 'Đi tiếp'}
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      <main className="map-wrap">
        <div ref={mapContainerRef} className="map" />
      </main>
    </div>
  )
}
