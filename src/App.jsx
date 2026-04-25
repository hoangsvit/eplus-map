import { useEffect, useMemo, useRef, useState } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'

const DEFAULT_CENTER = [106.70098, 10.77689]

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)

  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const apiKey = useMemo(() => import.meta.env.VITE_VIETMAP_API_KEY || '', [])

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

      setQuery(place.display || item.display || item.name || '')
      setSuggestions([])
    } catch (selectError) {
      setError(selectError.message || 'Không thể chọn địa điểm. Vui lòng thử lại.')
    } finally {
      setIsLoading(false)
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

        {!apiKey && <p className="mt-2 text-sm text-rose-600">Thiếu VITE_VIETMAP_API_KEY trong file .env.</p>}

        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        {isLoading && <p className="mt-2 text-xs text-slate-500">Đang tải gợi ý...</p>}

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
