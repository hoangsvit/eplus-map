import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const originMarkerRef = useRef(null)
  const destinationMarkerRef = useRef(null)

  const [originQuery, setOriginQuery] = useState('')
  const [destinationQuery, setDestinationQuery] = useState('')
  const [activeField, setActiveField] = useState('destination')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRouting, setIsRouting] = useState(false)
  const [error, setError] = useState('')
  const [selectedOrigin, setSelectedOrigin] = useState(null)
  const [selectedDestination, setSelectedDestination] = useState(null)
  const [routeSummary, setRouteSummary] = useState(null)

  const apiKey = useMemo(() => import.meta.env.VITE_VIETMAP_API_KEY || '', [])

  const removeRouteFromMap = () => {
    const map = mapInstanceRef.current
    if (!map) return

    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.removeLayer(ROUTE_LAYER_ID)
    }

    if (map.getSource(ROUTE_SOURCE_ID)) {
      map.removeSource(ROUTE_SOURCE_ID)
    }
  }

  const drawRouteOnMap = (coordinates) => {
    const map = mapInstanceRef.current
    if (!map || !Array.isArray(coordinates) || coordinates.length < 2) return

    removeRouteFromMap()

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
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#2563eb',
        'line-width': 6,
      },
    })

    const bounds = coordinates.reduce(
      (acc, coord) => acc.extend(coord),
      new vietmapgl.LngLatBounds(coordinates[0], coordinates[0]),
    )

    map.fitBounds(bounds, {
      padding: 60,
      maxZoom: 16,
      duration: 800,
    })
  }

  const decodePolyline = (encoded) => {
    if (!encoded || typeof encoded !== 'string') return []

    let index = 0
    let lat = 0
    let lng = 0
    const coordinates = []

    while (index < encoded.length) {
      let shift = 0
      let result = 0
      let byte = null

      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1
      lat += deltaLat

      shift = 0
      result = 0
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1
      lng += deltaLng

      coordinates.push([lng / 1e5, lat / 1e5])
    }

    return coordinates
  }

  const normalizePoint = (point) => {
    if (!Array.isArray(point) || point.length < 2) return null

    const first = Number(point[0])
    const second = Number(point[1])

    if (Number.isNaN(first) || Number.isNaN(second)) return null

    // Vietmap docs mention [lat,lng] for points_encoded=false.
    if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
      return [second, first]
    }

    // Fallback for [lng,lat]-formatted points.
    if (Math.abs(first) <= 180 && Math.abs(second) <= 90) {
      return [first, second]
    }

    return null
  }

  const extractRouteCoordinates = (route) => {
    if (!route) return []

    if (Array.isArray(route.points)) {
      return route.points.map(normalizePoint).filter(Boolean)
    }

    if (Array.isArray(route.points?.coordinates)) {
      return route.points.coordinates.map(normalizePoint).filter(Boolean)
    }

    if (typeof route.points === 'string') {
      return decodePolyline(route.points)
    }

    return []
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    mapInstanceRef.current = new vietmapgl.Map({
      container: mapRef.current,
      style: `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${apiKey}`,
      center: DEFAULT_CENTER,
      zoom: 12,
    })

    mapInstanceRef.current.addControl(new vietmapgl.NavigationControl(), 'top-right')

    return () => {
      if (originMarkerRef.current) {
        originMarkerRef.current.remove()
        originMarkerRef.current = null
      }

      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove()
        destinationMarkerRef.current = null
      }

      removeRouteFromMap()

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [apiKey])

  useEffect(() => {
    if (!apiKey) {
      setSuggestions([])
      return
    }

    const text = (activeField === 'origin' ? originQuery : destinationQuery).trim()

    if (text.length < 2) {
      setSuggestions([])
      setError('')
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        setIsLoading(true)
        setError('')

        const mapCenter = mapInstanceRef.current?.getCenter()
        const focus = mapCenter ? `${mapCenter.lat},${mapCenter.lng}` : `${DEFAULT_CENTER[1]},${DEFAULT_CENTER[0]}`

        const params = new URLSearchParams({
          apikey: apiKey,
          text,
          focus,
          display_type: '5',
        })

        const response = await fetch(`https://maps.vietmap.vn/api/autocomplete/v4?${params.toString()}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Không thể tải gợi ý địa điểm từ Vietmap.')
        }

        const data = await response.json()
        setSuggestions(Array.isArray(data) ? data : [])
      } catch (fetchError) {
        if (fetchError.name !== 'AbortError') {
          setSuggestions([])
          setError('Không thể tải gợi ý. Vui lòng thử lại.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }, 350)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [activeField, apiKey, destinationQuery, originQuery])

  const handleSelectSuggestion = async (item, field) => {
    if (!apiKey || !item?.ref_id) return

    try {
      setIsLoading(true)
      setError('')

      const params = new URLSearchParams({
        apikey: apiKey,
        refid: item.ref_id,
      })

      const response = await fetch(`https://maps.vietmap.vn/api/place/v4?${params.toString()}`)

      if (!response.ok) {
        throw new Error('Không thể lấy thông tin chi tiết địa điểm.')
      }

      const place = await response.json()

      if (typeof place?.lat !== 'number' || typeof place?.lng !== 'number') {
        throw new Error('Không có toạ độ hợp lệ cho địa điểm đã chọn.')
      }

      const map = mapInstanceRef.current
      if (!map) return

      const lngLat = [place.lng, place.lat]

      const selectedValue = { lat: place.lat, lng: place.lng, name: place.display || item.display || item.name || '' }
      if (field === 'origin') {
        if (!originMarkerRef.current) {
          originMarkerRef.current = new vietmapgl.Marker({ color: '#16a34a' }).setLngLat(lngLat).addTo(map)
        } else {
          originMarkerRef.current.setLngLat(lngLat)
        }
        setSelectedOrigin(selectedValue)
        setOriginQuery(selectedValue.name)
      } else {
        if (!destinationMarkerRef.current) {
          destinationMarkerRef.current = new vietmapgl.Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map)
        } else {
          destinationMarkerRef.current.setLngLat(lngLat)
        }
        setSelectedDestination(selectedValue)
        setDestinationQuery(selectedValue.name)
      }

      map.flyTo({
        center: lngLat,
        zoom: 15,
        essential: true,
      })

      removeRouteFromMap()
      setRouteSummary(null)
      setSuggestions([])
    } catch (selectError) {
      setError(selectError.message || 'Không thể chọn địa điểm. Vui lòng thử lại.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRoute = async () => {
    if (!apiKey || !selectedOrigin || !selectedDestination) return

    const map = mapInstanceRef.current
    if (!map) return

    try {
      setIsRouting(true)
      setError('')

      const params = new URLSearchParams({
        'api-version': '1.1',
        apikey: apiKey,
        vehicle: 'motorcycle',
        points_encoded: 'false',
      })
      params.append('point', `${selectedOrigin.lat},${selectedOrigin.lng}`)
      params.append('point', `${selectedDestination.lat},${selectedDestination.lng}`)

      const response = await fetch(`https://maps.vietmap.vn/api/route?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Không thể lấy dữ liệu dẫn đường từ Vietmap.')
      }

      const data = await response.json()
      const route = data?.paths?.[0]
      if (!route) {
        throw new Error('Không tìm thấy lộ trình phù hợp.')
      }

      const coordinates = extractRouteCoordinates(route)

      if (coordinates.length < 2) {
        throw new Error('Dữ liệu tuyến đường không hợp lệ.')
      }

      drawRouteOnMap(coordinates)
      setRouteSummary({
        distanceKm: route.distance ? (route.distance / 1000).toFixed(2) : null,
        durationMin: route.time ? Math.round(route.time / 60000) : null,
      })
    } catch (routeError) {
      setRouteSummary(null)
      setError(routeError.message || 'Không thể tạo tuyến đường. Vui lòng thử lại.')
    } finally {
      setIsRouting(false)
    }
  }

  return (
    <main className="relative h-full w-full">
      <div className="absolute left-4 top-4 z-10 w-[min(460px,calc(100%-2rem))] rounded-lg bg-white p-3 shadow-lg">
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="vietmap-origin">
          Điểm bắt đầu
        </label>
        <input
          id="vietmap-origin"
          type="text"
          value={originQuery}
          onFocus={() => setActiveField('origin')}
          onChange={(event) => {
            setActiveField('origin')
            setOriginQuery(event.target.value)
            setSelectedOrigin(null)
          }}
          placeholder="Nhập điểm đi..."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        />

        {suggestions.length > 0 && activeField === 'origin' && (
          <ul className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200">
            {suggestions.map((item) => (
              <li key={`origin-${item.ref_id}`}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(item, 'origin')}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 last:border-b-0"
                >
                  <p className="text-sm font-medium text-slate-800">{item.name || item.display}</p>
                  <p className="text-xs text-slate-500">{item.address}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="mb-2 mt-3 block text-sm font-medium text-slate-700" htmlFor="vietmap-destination">
          Điểm kết thúc
        </label>
        <input
          id="vietmap-destination"
          type="text"
          value={destinationQuery}
          onFocus={() => setActiveField('destination')}
          onChange={(event) => {
            setActiveField('destination')
            setDestinationQuery(event.target.value)
            setSelectedDestination(null)
          }}
          placeholder="Nhập điểm đến..."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        />

        {suggestions.length > 0 && activeField === 'destination' && (
          <ul className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200">
            {suggestions.map((item) => (
              <li key={`destination-${item.ref_id}`}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(item, 'destination')}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 last:border-b-0"
                >
                  <p className="text-sm font-medium text-slate-800">{item.name || item.display}</p>
                  <p className="text-xs text-slate-500">{item.address}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedOrigin && selectedDestination && (
          <button
            type="button"
            onClick={handleRoute}
            disabled={isRouting}
            className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isRouting ? 'Đang tạo tuyến đường...' : 'Dẫn đường'}
          </button>
        )}

        {!apiKey && <p className="mt-2 text-sm text-rose-600">Thiếu VITE_VIETMAP_API_KEY trong file .env.</p>}

        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        {isLoading && <p className="mt-2 text-xs text-slate-500">Đang tải gợi ý...</p>}

        {routeSummary && (
          <div className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <p className="font-medium">Thông tin lộ trình</p>
            <p>
              Quãng đường: <span className="font-semibold">{routeSummary.distanceKm} km</span>
            </p>
            <p>
              Thời gian dự kiến: <span className="font-semibold">{routeSummary.durationMin} phút</span>
            </p>
          </div>
        )}

      </div>

      <div ref={mapRef} className="h-full w-full" />
    </main>
  )
}
