import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'
import './App.css'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'
const API_KEY = 'YOUR_API_KEY'

function parseLatLng(value) {
  const [latRaw, lngRaw] = value.split(',').map((part) => part.trim())
  const lat = Number(latRaw)
  const lng = Number(lngRaw)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  return { lat, lng }
}

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

  const [startInput, setStartInput] = useState('10.77689,106.70098')
  const [endInput, setEndInput] = useState('10.762622,106.660172')
  const [vehicle, setVehicle] = useState('car')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [routeInfo, setRouteInfo] = useState(null)
  const [instructions, setInstructions] = useState([])

  const styleUrl = useMemo(
    () => `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${API_KEY}`,
    [],
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

  const handleFindRoute = async () => {
    const start = parseLatLng(startInput)
    const end = parseLatLng(endInput)

    if (!start || !end) {
      setError('Tọa độ không hợp lệ. Định dạng đúng: latitude,longitude')
      return
    }

    setError('')
    setIsLoading(true)
    setRouteInfo(null)
    setInstructions([])

    try {
      const params = new URLSearchParams({
        'api-version': '1.1',
        apikey: API_KEY,
        vehicle,
        points_encoded: 'false',
      })
      params.append('point', `${start.lat},${start.lng}`)
      params.append('point', `${end.lat},${end.lng}`)

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
      setMarker(startMarkerRef, [start.lng, start.lat], '#16a34a')
      setMarker(endMarkerRef, [end.lng, end.lat], '#dc2626')

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

        <label htmlFor="start">Điểm bắt đầu (latitude,longitude)</label>
        <input
          id="start"
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          placeholder="10.77689,106.70098"
        />

        <label htmlFor="end">Điểm kết thúc (latitude,longitude)</label>
        <input
          id="end"
          value={endInput}
          onChange={(e) => setEndInput(e.target.value)}
          placeholder="10.762622,106.660172"
        />

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
