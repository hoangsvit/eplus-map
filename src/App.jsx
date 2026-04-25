import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRouting, setIsRouting] = useState(false)
  const [error, setError] = useState('')
  const [selectedPlace, setSelectedPlace] = useState(null)
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

  const getCurrentPosition = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null)
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve([position.coords.longitude, position.coords.latitude])
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 },
      )
    })

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
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
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

    const text = query.trim()

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
  }, [apiKey, query])

  const handleSelectSuggestion = async (item) => {
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

      map.flyTo({
        center: lngLat,
        zoom: 16,
        essential: true,
      })

      if (!markerRef.current) {
        markerRef.current = new vietmapgl.Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map)
      } else {
        markerRef.current.setLngLat(lngLat)
      }

      removeRouteFromMap()
      setRouteSummary(null)
      setSelectedPlace({ lat: place.lat, lng: place.lng, name: place.display || item.display || item.name || '' })
      setQuery(place.display || item.display || item.name || '')
      setSuggestions([])
    } catch (selectError) {
      setError(selectError.message || 'Không thể chọn địa điểm. Vui lòng thử lại.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRoute = async () => {
    if (!apiKey || !selectedPlace) return

    const map = mapInstanceRef.current
    if (!map) return

    try {
      setIsRouting(true)
      setError('')

      const currentPosition = await getCurrentPosition()
      const mapCenter = map.getCenter()
      const origin = currentPosition || [mapCenter.lng, mapCenter.lat]

      const params = new URLSearchParams({
        'api-version': '1.1',
        apikey: apiKey,
        vehicle: 'motorcycle',
        points_encoded: 'false',
      })
      params.append('point', `${origin[1]},${origin[0]}`)
      params.append('point', `${selectedPlace.lat},${selectedPlace.lng}`)

      const response = await fetch(`https://maps.vietmap.vn/api/route?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Không thể lấy dữ liệu dẫn đường từ Vietmap.')
      }

      const data = await response.json()
      const route = data?.paths?.[0]
      if (!route) {
        throw new Error('Không tìm thấy lộ trình phù hợp.')
      }

      const coordinates = Array.isArray(route.points)
        ? route.points
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => [point[1], point[0]])
        : []

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
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="vietmap-search">
          Tìm kiếm địa điểm
        </label>
        <input
          id="vietmap-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nhập địa chỉ, toà nhà, địa điểm..."
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-500 focus:ring-2"
        />

        {selectedPlace && (
          <button
            type="button"
            onClick={handleRoute}
            disabled={isRouting}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isRouting ? 'Đang tạo tuyến đường...' : 'Dẫn đường đến địa điểm đã chọn'}
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

        {suggestions.length > 0 && (
          <ul className="mt-2 max-h-72 overflow-y-auto rounded-md border border-slate-200">
            {suggestions.map((item) => (
              <li key={item.ref_id}>
                <button
                  type="button"
                  onClick={() => handleSelectSuggestion(item)}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 last:border-b-0"
                >
                  <p className="text-sm font-medium text-slate-800">{item.name || item.display}</p>
                  <p className="text-xs text-slate-500">{item.address}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={mapRef} className="h-full w-full" />
    </main>
  )
}
