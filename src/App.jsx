import { useEffect, useRef } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const apiKey = import.meta.env.VITE_VIETMAP_API_KEY || ''

    mapInstanceRef.current = new vietmapgl.Map({
      container: mapRef.current,
      style: `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${apiKey}`,
      center: [106.70098, 10.77689],
      zoom: 12,
    })

    mapInstanceRef.current.addControl(new vietmapgl.NavigationControl(), 'top-right')

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  return (
    <main className="h-full w-full">
      <section className="absolute left-4 top-4 z-10 max-w-sm rounded-xl bg-white/95 p-4 shadow-lg backdrop-blur">
        <h1 className="text-lg font-semibold text-slate-900">Vietmap + React + Tailwind</h1>
        <p className="mt-2 text-sm text-slate-600">
          Đặt API key vào file <code className="rounded bg-slate-100 px-1">.env</code>:
          <br />
          <code className="mt-1 inline-block rounded bg-slate-100 px-1 py-0.5">
            VITE_VIETMAP_API_KEY=your_key
          </code>
        </p>
      </section>

      <div ref={mapRef} className="h-full w-full" />
    </main>
  )
}
