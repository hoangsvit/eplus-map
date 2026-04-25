import { useEffect, useRef } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
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
      <div ref={mapRef} className="h-full w-full" />
    </main>
  )
}
