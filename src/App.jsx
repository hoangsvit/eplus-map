import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import vietmapgl from '@vietmap/vietmap-gl-js/dist/vietmap-gl.js'
import '@vietmap/vietmap-gl-js/dist/vietmap-gl.css'
import './App.css'
import { apiService } from './services/api'

const DEFAULT_CENTER = [106.70098, 10.77689]
const ROUTE_SOURCE_ID = 'route-source'
const ROUTE_LAYER_ID = 'route-layer'
const VEHICLES = [
  { key: 'car', icon: 'fa-solid fa-car', label: 'Ô tô' },
  { key: 'motorcycle', icon: 'fa-solid fa-motorcycle', label: 'Xe máy' },
  { key: 'bike', icon: 'fa-solid fa-bicycle', label: 'Xe đạp' },
  { key: 'foot', icon: 'fa-solid fa-person-walking', label: 'Đi bộ' },
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
  
  // Marker Refs
  const placeMarkerRef = useRef(null)
  const routeMarkersRef = useRef([])

  const apiKey = useMemo(() => import.meta.env.VITE_VIETMAP_API_KEY || '', [])
  const [tilemapStyle, setTilemapStyle] = useState('vectorDefault')
  const styleUrl = useMemo(
    () => apiService.getTilemapStyleUrl(tilemapStyle, apiKey),
    [tilemapStyle, apiKey],
  )

  const [mode, setMode] = useState('browse')
  
  // States for Browse Mode
  const [focusedInput, setFocusedInput] = useState('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlace, setSelectedPlace] = useState(null)
  
  // States for Route Mode
  const [routePoints, setRoutePoints] = useState([
    { id: 'start', place: null, query: '' },
    { id: 'end', place: null, query: '' }
  ])
  const [focusedPointIndex, setFocusedPointIndex] = useState(null)
  const [vehicle, setVehicle] = useState('car')
  
  // Common States
  const [isSuggestOpen, setIsSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [isRouting, setIsRouting] = useState(false)
  const [routeInfo, setRouteInfo] = useState(null)
  const [allRoutes, setAllRoutes] = useState([])
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0)
  const [instructions, setInstructions] = useState([])
  const [tolls, setTolls] = useState([])
  const [showSteps, setShowSteps] = useState(false)
  const [error, setError] = useState('')
  const [showTraffic, setShowTraffic] = useState(true)
  const [trafficStyle, setTrafficStyle] = useState(null)
  const [isSidebarVisible, setIsSidebarVisible] = useState(true)

  // Track active state for Map click events without re-binding
  const activeStateRef = useRef({ mode, focusedInput, focusedPointIndex, routePoints, searchQuery })
  useEffect(() => {
    activeStateRef.current = { mode, focusedInput, focusedPointIndex, routePoints, searchQuery }
  }, [mode, focusedInput, focusedPointIndex, routePoints, searchQuery])

  const tollTotal = useMemo(
    () => tolls.reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0),
    [tolls],
  )

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Bỏ qua nếu click vào map canvas (để map click tự xử lý reverse geocode)
      if (e.target.closest('.mapboxgl-canvas') || e.target.closest('.map')) return;
      
      // Nếu không click vào khu vực UI (search bar hoặc sidebar)
      if (!e.target.closest('.search-ui-container')) {
        setIsSuggestOpen(false);
        setFocusedInput(null);
        setFocusedPointIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch Traffic Style JSON
  useEffect(() => {
    if (!apiKey) return;
    fetch(`https://maps.vietmap.vn/maps/styles/tf/style.json?apikey=${apiKey}`)
      .then(r => r.json())
      .then(data => setTrafficStyle(data))
      .catch(err => console.error('Lỗi tải style giao thông:', err));
  }, [apiKey]);

  // Apply or Remove Traffic Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trafficStyle) return;

    const applyTraffic = () => {
      if (showTraffic) {
        // Thêm nguồn dữ liệu và các lớp giao thông
        Object.entries(trafficStyle.sources).forEach(([id, source]) => {
          if (!map.getSource(id)) map.addSource(id, source);
        });
        trafficStyle.layers.forEach(layer => {
          if (!map.getLayer(layer.id)) map.addLayer(layer);
        });
      } else {
        // Xóa các lớp giao thông
        trafficStyle.layers.forEach(layer => {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        });
        // Xóa các nguồn dữ liệu
        Object.keys(trafficStyle.sources).forEach(id => {
          if (map.getSource(id)) {
            try { map.removeSource(id); } catch(e) {}
          }
        });
      }
    };

    // Thực hiện ngay lập tức nếu bản đồ đã load xong style
    if (map.isStyleLoaded()) {
      applyTraffic();
    }

    // Lắng nghe sự kiện style.load để áp dụng lại lớp giao thông khi đổi kiểu bản đồ (Vector <-> Raster)
    map.on('style.load', applyTraffic);

    return () => {
      map.off('style.load', applyTraffic);
    };
  }, [showTraffic, trafficStyle]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = new vietmapgl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: 14,
    })
    mapRef.current = map

    map.addControl(
      new vietmapgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
      }),
      'bottom-right',
    )
    map.addControl(
      new vietmapgl.NavigationControl({ showZoom: true, showCompass: true }),
      'bottom-right',
    )
    map.addControl(
      new vietmapgl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
      'bottom-left',
    )
    map.addControl(new vietmapgl.FullscreenControl(), 'bottom-right')

    // Click Map -> Reverse Geocoding
    const handleMapClick = async (e) => {
      const state = activeStateRef.current
      if ((state.mode === 'browse' && state.focusedInput === 'search') || 
          (state.mode === 'route' && state.focusedPointIndex !== null)) {
        try {
          const { lng, lat } = e.lngLat
          const result = await apiService.reverseGeocode(lat, lng, apiKey)
          if (result && result.ref_id) {
            const place = await apiService.getPlaceDetail(result.ref_id, apiKey)
            const placeData = { ...place, lat, lng }
            
            if (state.mode === 'browse') {
               setSelectedPlace(placeData)
               setSearchQuery(placeData.display)
               setMarker(placeMarkerRef, [lng, lat], '#ef4444')
               setFocusedInput(null)
               setSuggestions([])
               setIsSuggestOpen(false)
               map.flyTo({ center: [lng, lat], zoom: 16 })
            } else if (state.mode === 'route' && state.focusedPointIndex !== null) {
               const newPoints = [...state.routePoints]
               newPoints[state.focusedPointIndex] = {
                 ...newPoints[state.focusedPointIndex],
                 place: placeData,
                 query: placeData.display
               }
               setRoutePoints(newPoints)
               setFocusedPointIndex(null)
               setSuggestions([])
               setIsSuggestOpen(false)
               map.flyTo({ center: [lng, lat], zoom: 16 })
            }
          }
        } catch(err) {
          console.error('Lỗi lấy địa chỉ:', err)
        }
      }
    }
    map.on('click', handleMapClick)

    return () => {
      if (placeMarkerRef.current) placeMarkerRef.current.remove()
      routeMarkersRef.current.forEach(m => m.remove())
      map.off('click', handleMapClick)
      map.remove()
      mapRef.current = null
    }
  }, [styleUrl, apiKey])

  // Lắng nghe thay đổi query để gợi ý (Autocomplete)
  useEffect(() => {
    if (!apiKey || !isSuggestOpen) return
    let query = ''
    if (mode === 'browse' && focusedInput === 'search') {
       query = searchQuery
    } else if (mode === 'route' && focusedPointIndex !== null) {
       query = routePoints[focusedPointIndex]?.query || ''
    }
    query = query.trim()
    
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
        if (!controller.signal.aborted) setSuggestions(data)
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
  }, [apiKey, isSuggestOpen, searchQuery, focusedInput, focusedPointIndex, routePoints, mode])

  const setMarker = (refObj, lngLat, color) => {
    const map = mapRef.current
    if (!map) return
    if (!refObj.current) {
      refObj.current = new vietmapgl.Marker({ color }).setLngLat(lngLat).addTo(map)
    } else {
      refObj.current.setLngLat(lngLat)
    }
  }

  const syncRouteMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    routeMarkersRef.current.forEach(m => m.remove());
    routeMarkersRef.current = [];
    
    routePoints.forEach((pt, idx) => {
      if (pt.place) {
        const color = idx === 0 ? '#1d4ed8' : (idx === routePoints.length - 1 ? '#ef4444' : '#f59e0b');
        const marker = new vietmapgl.Marker({ color, draggable: true })
          .setLngLat([pt.place.lng, pt.place.lat])
          .addTo(map);
          
        marker.on('dragend', async () => {
          const lngLat = marker.getLngLat();
          try {
            const result = await apiService.reverseGeocode(lngLat.lat, lngLat.lng, apiKey);
            if (result && result.ref_id) {
               const place = await apiService.getPlaceDetail(result.ref_id, apiKey);
               const placeData = { ...place, lat: lngLat.lat, lng: lngLat.lng };
               setRoutePoints(prev => {
                 const newPoints = [...prev];
                 newPoints[idx] = {
                   ...newPoints[idx],
                   place: placeData,
                   query: placeData.display
                 };
                 return newPoints;
               });
            }
          } catch(err) {
            console.error('Lỗi khi kéo thả marker:', err);
          }
        });
        
        routeMarkersRef.current.push(marker);
      }
    });
  }, [routePoints, apiKey]);

  const removeRouteLayer = () => {
    const map = mapRef.current
    if (!map) return
    
    try {
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach(layer => {
          if (layer.id.startsWith('route-layer-')) map.removeLayer(layer.id);
        });
      }
      if (style && style.sources) {
        Object.keys(style.sources).forEach(sourceId => {
          if (sourceId.startsWith('route-source-')) map.removeSource(sourceId);
        });
      }
    } catch (e) {
      console.error('Lỗi khi xóa layer route:', e);
    }
  }

  const drawRoutes = (routes, selectedIdx) => {
    const map = mapRef.current
    if (!map || routes.length === 0) return
    removeRouteLayer()

    // Vẽ các đường phụ trước (màu xám, mờ)
    routes.forEach((route, idx) => {
      if (idx === selectedIdx) return;
      const coords = extractCoordinates(route.points);
      if (coords.length < 2) return;
      
      const sourceId = `route-source-${idx}`;
      const layerId = `route-layer-${idx}`;
      
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
      })
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 5, 'line-opacity': 0.6 },
      })
      
      // Thêm sự kiện click để chọn đường này
      map.on('click', layerId, () => {
        setSelectedRouteIndex(idx);
      });
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    });

    // Vẽ đường chính (màu xanh, trên cùng)
    const mainRoute = routes[selectedIdx];
    if (!mainRoute) return;
    const mainCoords = extractCoordinates(mainRoute.points);
    if (mainCoords.length >= 2) {
      const sourceId = `route-source-${selectedIdx}`;
      const layerId = `route-layer-${selectedIdx}`;
      
      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: mainCoords } },
      })
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2f64ff', 'line-width': 7 },
      })

      const bounds = mainCoords.reduce(
        (acc, coord) => acc.extend(coord),
        new vietmapgl.LngLatBounds(mainCoords[0], mainCoords[0]),
      )
      map.fitBounds(bounds, { padding: 50 })
    }
  }

  useEffect(() => {
    if (mode === 'route') {
      syncRouteMarkers();
    }
  }, [routePoints, mode, syncRouteMarkers]);

  const handleSelectSuggestion = async (item, pointIndex = null) => {
    if (!item?.ref_id || !apiKey) return
    try {
      setError('')
      const place = await apiService.getPlaceDetail(item.ref_id, apiKey)
      const lngLat = [place.lng, place.lat]

      if (mode === 'browse' && focusedInput === 'search') {
        setSelectedPlace(place)
        setSearchQuery(place.display)
        setMarker(placeMarkerRef, lngLat, '#ef4444')
        mapRef.current?.flyTo({ center: lngLat, zoom: 16, essential: true })
      } else if (mode === 'route' && pointIndex !== null) {
        const newPoints = [...routePoints]
        newPoints[pointIndex] = {
          ...newPoints[pointIndex],
          place: place,
          query: place.display
        }
        setRoutePoints(newPoints)
        mapRef.current?.flyTo({ center: lngLat, zoom: 16, essential: true })
      }

      setSuggestions([])
      setIsSuggestOpen(false)
      setFocusedInput(null)
      setFocusedPointIndex(null)
      
      if (mode === 'browse') {
        setRouteInfo(null)
        setInstructions([])
        setShowSteps(false)
        removeRouteLayer()
      }
    } catch (err) {
      setError(err.message || 'Không thể chọn địa điểm.')
    }
  }

  // Handle Enter Key (Geocode Search)
  const handleKeyDown = async (e, pointIndex = null) => {
    if (e.key === 'Enter') {
      const query = pointIndex !== null ? routePoints[pointIndex].query : searchQuery;
      if (!query || query.length < 2) return;
      
      try {
        setIsSearching(true);
        const center = mapRef.current?.getCenter()
        const focus = center ? `${center.lat},${center.lng}` : null
        
        const results = await apiService.searchGeocode(query, focus, apiKey)
        if (results && results.length > 0) {
          await handleSelectSuggestion(results[0], pointIndex)
        } else {
          setError('Không tìm thấy kết quả nào.')
        }
      } catch (err) {
        setError(err.message || 'Lỗi tìm kiếm.')
      } finally {
        setIsSearching(false)
      }
    }
  }

  const handleOpenDirection = useCallback(() => {
    setMode('route')
    setIsSidebarVisible(true)
    setFocusedPointIndex(0)
    setIsSuggestOpen(false)
    setSuggestions([])

    const initialPoints = [
      { id: 'start', place: null, query: '' },
      { id: 'end', place: null, query: '' }
    ]

    if (selectedPlace) {
      initialPoints[1] = {
        id: 'end',
        place: selectedPlace,
        query: selectedPlace.display
      }
    }
    setRoutePoints(initialPoints)
    if (placeMarkerRef.current) {
       placeMarkerRef.current.remove()
       placeMarkerRef.current = null
    }
  }, [selectedPlace])

  const handleStopDirection = () => {
    setMode('browse')
    setFocusedInput('search')
    setIsSuggestOpen(false)
    setSuggestions([])
    setRouteInfo(null)
    setInstructions([])
    setTolls([])
    setShowSteps(false)
    removeRouteLayer()
    routeMarkersRef.current.forEach(m => m.remove())
    routeMarkersRef.current = []

    const destination = routePoints[routePoints.length - 1]?.place
    if (destination) {
      setSelectedPlace(destination)
      setSearchQuery(destination.display || '')
      setMarker(placeMarkerRef, [destination.lng, destination.lat], '#ef4444')
    } else {
       setSelectedPlace(null)
       setSearchQuery('')
    }
  }

  const handleAddStop = () => {
    const newPoints = [...routePoints]
    newPoints.splice(newPoints.length - 1, 0, { id: Date.now().toString(), place: null, query: '' })
    setRoutePoints(newPoints)
  }

  const handleRemoveStop = (index) => {
    if (routePoints.length <= 2) return
    const newPoints = [...routePoints]
    newPoints.splice(index, 1)
    setRoutePoints(newPoints)
  }

  const handleSwap = () => {
    const newPoints = [...routePoints].reverse()
    setRoutePoints(newPoints)
  }

  // Tự động tìm đường khi có đủ điểm
  useEffect(() => {
    if (mode !== 'route') return
    const validPoints = routePoints.filter(p => p.place)
    if (validPoints.length < 2) {
      setRouteInfo(null)
      setInstructions([])
      setTolls([])
      removeRouteLayer()
      return
    }

    const timeout = setTimeout(() => {
      fetchRoute()
    }, 500)

    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, routePoints, vehicle])

  const fetchRoute = async () => {
    // Tự động geocode các điểm chưa có tọa độ (place)
    const updatedPoints = [...routePoints];
    let hasChanges = false;
    
    for (let i = 0; i < updatedPoints.length; i++) {
      const pt = updatedPoints[i];
      if (!pt.place && pt.query.trim().length > 0) {
        try {
          setIsSearching(true);
          const center = mapRef.current?.getCenter();
          const focus = center ? `${center.lat},${center.lng}` : null;
          const results = await apiService.searchGeocode(pt.query, focus, apiKey);
          if (results && results.length > 0) {
            const place = await apiService.getPlaceDetail(results[0].ref_id, apiKey);
            updatedPoints[i].place = place;
            updatedPoints[i].query = place.display;
            hasChanges = true;
          }
        } catch(err) {
          console.error('Lỗi tự động geocode:', err);
        } finally {
          setIsSearching(false);
        }
      }
    }
    
    if (hasChanges) {
      setRoutePoints(updatedPoints);
      // Khi state thay đổi, useEffect auto route sẽ tự động gọi lại fetchRoute!
      return; 
    }

    const validPoints = updatedPoints.filter(p => p.place)
    if (validPoints.length < 2) {
      setRouteInfo(null)
      setInstructions([])
      setTolls([])
      removeRouteLayer()
      setError('Vui lòng chọn hoặc nhập ít nhất 2 địa điểm hợp lệ.')
      return
    }

    try {
      setIsRouting(true)
      setError('')

      const pointsCoords = validPoints.map(p => p.place)
      const routes = await apiService.getRoute(pointsCoords, vehicle, apiKey)
      
      setAllRoutes(routes)
      setSelectedRouteIndex(0)

      const mainRoute = routes[0]
      setRouteInfo({
        distanceKm: (mainRoute.distance / 1000).toFixed(2),
        durationMin: Math.round(mainRoute.time / 60000),
      })
      setInstructions(mainRoute.instructions)

      drawRoutes(routes, 0)

      if (vehicle === 'car') {
        const tollList = await apiService.getRouteTolls(pointsCoords, apiKey)
        setTolls(tollList)
      } else {
        setTolls([])
      }

      setShowSteps(false)
      setIsSuggestOpen(false)
    } catch (err) {
      setError(err.message || 'Không thể tìm đường.')
      setAllRoutes([])
      setRouteInfo(null)
      setInstructions([])
      setTolls([])
    } finally {
      setIsRouting(false)
    }
  }

  // Cập nhật thông tin khi đổi đường đi được chọn
  useEffect(() => {
    if (allRoutes.length > 0) {
      const selected = allRoutes[selectedRouteIndex];
      if (selected) {
        setRouteInfo({
          distanceKm: (selected.distance / 1000).toFixed(2),
          durationMin: Math.round(selected.time / 60000),
        });
        setInstructions(selected.instructions);
        drawRoutes(allRoutes, selectedRouteIndex);
      }
    }
  }, [selectedRouteIndex, allRoutes]);

  const handleChangeTilemapStyle = (styleName) => {
    setTilemapStyle(styleName)
    if (mapRef.current) {
      const newStyleUrl = apiService.getTilemapStyleUrl(styleName, apiKey)
      mapRef.current.setStyle(newStyleUrl)
    }
  }

  return (
    <div className="screen relative overflow-hidden h-screen w-full font-sans bg-slate-50">
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      {!apiKey && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">Thiếu VITE_VIETMAP_API_KEY trong .env.</div>}
      {error && <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">{error}</div>}

      {/* CHẾ ĐỘ BROWSE - THANH TÌM KIẾM */}
      {mode === 'browse' && (
        <div className="search-ui-container absolute z-20 top-[max(10px,env(safe-area-inset-top))] left-3 right-3 md:left-4 md:right-auto">
          <div className="relative flex flex-col w-full md:w-[390px] max-w-full">
            <div className={`relative flex items-center bg-white shadow-[0_2px_12px_rgba(0,0,0,0.18)] z-10 rounded-full border border-slate-100 ${
              isSuggestOpen && suggestions.length > 0 && searchQuery ? 'rounded-t-2xl rounded-b-none border-b border-slate-100' : 'rounded-2xl'
            } ${focusedInput === 'search' ? 'ring-2 ring-blue-500' : ''}`}>
              <button className="absolute left-1.5 w-9 h-9 rounded-full bg-transparent text-slate-500 hover:bg-slate-100 transition-colors">
                <i className="fa-solid fa-bars text-[15px]"></i>
              </button>
              <i className="fa-solid fa-magnifying-glass absolute left-12 text-slate-400 text-[15px] pointer-events-none"></i>
              <input
                className="w-full bg-transparent border-none py-3 pl-[70px] pr-11 text-[15px] outline-none text-slate-800 placeholder-slate-400"
                value={searchQuery}
                onFocus={() => setFocusedInput('search')}
                onChange={(e) => {
                  setFocusedInput('search')
                  setSearchQuery(e.target.value)
                  setSelectedPlace(null)
                  setIsSuggestOpen(true)
                }}
                onKeyDown={(e) => handleKeyDown(e, null)}
                placeholder={searchQuery ? '' : 'Tìm kiếm địa điểm'}
              />
              {searchQuery && (
                <button className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer" onClick={() => { setSearchQuery(''); setSuggestions([]); setSelectedPlace(null) }}>
                  <i className="fa-solid fa-xmark text-lg"></i>
                </button>
              )}
            </div>

            {/* Suggestions Dropdown (Browse) */}
            {isSuggestOpen && focusedInput === 'search' && suggestions.length > 0 && (
              <div className="bg-white rounded-b-2xl shadow-[0_8px_24px_rgba(0,0,0,0.15)] overflow-hidden flex flex-col mt-[-1px]">
                <ul className="m-0 p-0 list-none max-h-[320px] overflow-y-auto">
                  {suggestions.map((item) => (
                    <li key={item.ref_id} className="border-b border-slate-100 last:border-b-0">
                      <button 
                        type="button" 
                        onClick={() => handleSelectSuggestion(item, null)}
                        className="w-full text-left bg-white border-none py-3 px-4 flex gap-3 hover:bg-slate-50 transition-colors cursor-pointer items-start"
                      >
                        <i className="fa-solid fa-location-dot text-slate-400 mt-1 text-[15px]"></i>
                        <div className="flex-1 flex flex-col">
                          <strong className="text-[15px] font-medium text-slate-800 font-sans leading-tight mb-1">{item.name || item.display}</strong>
                          <span className="text-[13px] text-slate-500 leading-snug">{item.address}</span>
                          {item.oldAddress && <span className="text-[13px] text-blue-500 mt-1 leading-snug">Mới: {item.oldAddress}</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="py-3 text-center border-t border-slate-100 text-[13px] bg-slate-50/50">
                  <a href="#!" onClick={(e) => e.preventDefault()} className="text-red-500 hover:underline cursor-pointer decoration-transparent">Báo lỗi tìm kiếm</a>
                  <span className="mx-2 text-slate-300">•</span>
                  <a href="#!" onClick={(e) => e.preventDefault()} className="text-blue-500 hover:underline cursor-pointer decoration-transparent">Đăng kí API key</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHẾ ĐỘ ROUTE - SIDEBAR BÊN TRÁI */}
      {mode === 'route' && (
        <>
          {/* Nút Hiện Sidebar (khi đã ẩn) */}
          {!isSidebarVisible && (
            <button
              onClick={() => setIsSidebarVisible(true)}
              className="absolute z-40 top-4 left-4 md:top-4 md:left-4 w-10 h-10 md:w-11 md:h-11 bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center text-blue-600 hover:bg-slate-50 transition-all border border-slate-100"
              title="Hiện danh sách"
            >
              <i className="fa-solid fa-list-ul text-lg"></i>
            </button>
          )}

          <div className={`search-ui-container absolute left-0 right-0 bottom-0 h-[82dvh] md:h-auto md:top-0 md:bottom-0 md:right-auto w-full md:w-[400px] max-w-full bg-slate-50 z-30 shadow-[0_-8px_24px_rgba(0,0,0,0.16)] md:shadow-[4px_0_24px_rgba(0,0,0,0.1)] rounded-t-3xl md:rounded-none flex flex-col overflow-hidden transition-transform duration-300 ${
            isSidebarVisible ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:-translate-x-full'
          }`}>
            {/* Header Xanh */}
            <div className="bg-white pt-3 md:pt-8 pb-3 md:pb-4 px-4 relative flex-shrink-0 border-b border-slate-200">
              <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-3 md:hidden"></div>
              <button 
                onClick={() => setIsSidebarVisible(false)} 
                className="absolute top-3 md:top-4 left-4 w-8 h-8 bg-slate-100 md:bg-white/10 rounded-full flex items-center justify-center text-slate-700 md:text-white hover:bg-slate-200 md:hover:bg-white/20 transition-colors"
                title="Ẩn danh sách"
              >
                <i className="fa-solid fa-chevron-down text-[12px] md:hidden"></i>
                <i className="fa-solid fa-chevron-left text-[12px] hidden md:block"></i>
              </button>
              <button 
                onClick={handleStopDirection} 
                className="absolute top-3 md:top-4 right-4 w-8 h-8 bg-slate-100 md:bg-white rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-200 md:hover:bg-slate-100 shadow"
              >
              <i className="fa-solid fa-xmark"></i>
            </button>
            <div className="text-slate-700 md:text-white text-[15px] font-medium mb-3 md:mb-4 text-center md:text-left">Phương tiện di chuyển</div>
            
            <div className="flex gap-2 bg-slate-100 md:bg-white/10 p-1.5 rounded-lg shadow-sm">
              {VEHICLES.map((item) => (
                <button
                  key={item.key}
                  className={`flex-1 py-2.5 rounded-md flex items-center justify-center gap-2 text-[14px] font-medium transition-colors ${
                    item.key === vehicle 
                      ? 'bg-slate-900 text-white shadow-sm' 
                      : 'text-slate-600 md:text-white hover:bg-slate-200 md:hover:bg-white/20'
                  }`}
                  onClick={() => setVehicle(item.key)}
                >
                  <i className={item.icon} />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 relative">
            
            {/* Input Points */}
            <div className="relative flex flex-col gap-3">
              {routePoints.map((pt, index) => (
                <div key={pt.id} className={`relative flex items-center gap-3 ${focusedPointIndex === index ? 'z-50' : 'z-10'}`}>
                  <div className="flex flex-col items-center justify-center w-5 shrink-0 relative h-full">
                    {index < routePoints.length - 1 && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-[2px] h-[calc(100%+12px)] bg-slate-300 z-0"></div>}
                    <div className="bg-slate-50 py-1 z-10">
                      <i className={`fa-solid text-[14px] ${index === 0 ? 'fa-circle-dot text-blue-600' : index === routePoints.length - 1 ? 'fa-location-dot text-red-500' : 'fa-circle text-amber-500'}`}></i>
                    </div>
                  </div>
                  
                  <div className={`relative flex-1 bg-white rounded-lg border transition-colors shadow-sm ${focusedPointIndex === index ? 'ring-2 ring-blue-500 border-transparent z-20' : 'border-slate-200 z-10'}`}>
                    <input 
                      className="w-full bg-transparent text-[14px] py-3 pl-3 pr-8 outline-none text-slate-800 placeholder-slate-400"
                      placeholder={index === 0 ? 'Vị trí bắt đầu' : index === routePoints.length - 1 ? 'Chọn điểm đến' : 'Điểm dừng...'}
                      value={pt.query}
                      onFocus={() => {
                        setFocusedPointIndex(index)
                        setIsSuggestOpen(true)
                      }}
                      onChange={(e) => {
                        setFocusedPointIndex(index)
                        setIsSuggestOpen(true)
                        const newPoints = [...routePoints]
                        newPoints[index].query = e.target.value
                        newPoints[index].place = null
                        setRoutePoints(newPoints)
                      }}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                    />
                    {pt.query && (
                      <button 
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        onClick={() => {
                          const newPoints = [...routePoints]
                          newPoints[index].query = ''
                          newPoints[index].place = null
                          setRoutePoints(newPoints)
                        }}
                      >
                         <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}

                    {/* Inline Suggestions Dropdown */}
                    {isSuggestOpen && focusedPointIndex === index && suggestions.length > 0 && (
                      <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.2)] border border-slate-100 overflow-hidden z-[100]">
                         <ul className="m-0 p-0 list-none max-h-[300px] overflow-y-auto">
                            {suggestions.map((item) => (
                              <li key={item.ref_id} className="border-b border-slate-50 last:border-0">
                                <button 
                                  className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-start gap-3 transition-colors"
                                  onClick={() => handleSelectSuggestion(item, focusedPointIndex)}
                                >
                                  <i className="fa-solid fa-location-dot text-slate-400 mt-1"></i>
                                  <div className="flex-1">
                                    <div className="font-medium text-slate-800 text-[14px]">{item.name || item.display}</div>
                                    <div className="text-[13px] text-slate-500 leading-snug">{item.address}</div>
                                  </div>
                                </button>
                              </li>
                            ))}
                         </ul>
                      </div>
                    )}
                  </div>

                  {routePoints.length > 2 && (
                    <button 
                      className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors shrink-0 shadow-sm border border-slate-200 bg-white"
                      onClick={() => handleRemoveStop(index)}
                      title="Xóa điểm"
                    >
                      <i className="fa-solid fa-minus"></i>
                    </button>
                  )}
                  {routePoints.length <= 2 && (
                    <div className="w-8 shrink-0"></div>
                  )}
                </div>
              ))}

              <button 
                className="absolute right-9 top-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center text-slate-600 hover:bg-slate-50 z-20"
                onClick={handleSwap}
                title="Đảo chiều"
              >
                <i className="fa-solid fa-arrow-up-arrow-down text-[13px]"></i>
              </button>
            </div>

            <button 
              className="w-full py-3 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-100 flex items-center justify-center gap-2 text-[14px] transition-colors mt-2"
              onClick={handleAddStop}
            >
              <i className="fa-solid fa-plus"></i> Thêm điểm dừng
            </button>

            <button 
              className="w-full py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-black flex items-center justify-center gap-2 text-[15px] shadow-md transition-colors mt-2"
              onClick={fetchRoute}
              disabled={isRouting}
            >
              {isRouting ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
              {isRouting ? 'Đang tìm...' : 'Tìm đường'}
            </button>

            {/* Removed Global Suggestions Overlay */}

            {/* Lộ trình khả dụng */}
            {routeInfo && (
              <div className="mt-4 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                <div className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Lộ trình khả dụng</div>
                <div className="flex gap-4">
                  <div className="w-2 rounded-full bg-blue-500"></div>
                  <div className="flex-1">
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-2xl font-semibold text-slate-800">{routeInfo.distanceKm} km</span>
                      <span className="text-lg text-slate-600">{routeInfo.durationMin} phút</span>
                    </div>
                    {vehicle === 'car' && (
                      <div className="text-[13px] text-slate-500 mt-1">
                        Phí cao tốc: <strong className="text-slate-700">{tollTotal > 0 ? `${tollTotal.toLocaleString('vi-VN')} đ` : '0 đ'}</strong>
                      </div>
                    )}

                    {/* Alternative Routes List */}
                    {allRoutes.length > 1 && (
                      <div className="mt-4 border-t border-slate-100 pt-4 px-1 overflow-x-auto flex gap-3 no-scrollbar pb-2">
                        {allRoutes.map((route, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedRouteIndex(idx)}
                            className={`flex flex-col items-start p-3 rounded-xl border-2 transition-all shrink-0 min-w-[140px] ${
                              selectedRouteIndex === idx 
                                ? 'border-blue-600 bg-blue-50/50 shadow-sm' 
                                : 'border-slate-100 bg-white hover:border-slate-300'
                            }`}
                          >
                            <span className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${selectedRouteIndex === idx ? 'text-blue-600' : 'text-slate-400'}`}>
                              Đường {idx + 1} {idx === 0 && '(Gợi ý)'}
                            </span>
                            <div className="flex items-baseline gap-1">
                              <span className="text-base font-bold text-slate-800">{(route.distance / 1000).toFixed(1)}</span>
                              <span className="text-[11px] font-medium text-slate-500">km</span>
                            </div>
                            <span className="text-xs font-medium text-slate-600 mt-0.5">
                              {Math.round(route.time / 60000)} phút
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    <button 
                      className="mt-4 w-full py-2 bg-slate-50 border border-slate-200 rounded-md text-[14px] font-medium text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-2"
                      onClick={() => setShowSteps(!showSteps)}
                    >
                      <i className="fa-regular fa-map"></i> {showSteps ? 'Ẩn chi tiết' : 'Xem chi tiết'}
                    </button>
                  </div>
                </div>

                {/* Steps Dropdown */}
                {showSteps && (
                   <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-3">
                      {instructions.map((step, idx) => (
                         <div key={idx} className="flex gap-3 text-[14px]">
                           <i className="fa-solid fa-arrow-turn-up text-slate-400 mt-1"></i>
                           <div className="flex-1">
                             <div className="text-slate-800 font-medium">{step.text}</div>
                             <div className="text-slate-500 text-[13px]">{Math.round(step.distance)} m</div>
                           </div>
                         </div>
                      ))}
                   </div>
                )}
              </div>
            )}
            
          </div>
        </div>
      </>
    )}

      {/* Floating Buttons */}
      {mode === 'browse' && (
        <button
          type="button"
          className="absolute z-20 bottom-[max(84px,calc(env(safe-area-inset-bottom)+72px))] md:top-20 md:bottom-auto left-3 md:left-4 w-10 h-10 md:w-11 md:h-11 bg-white rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.18)] flex items-center justify-center text-blue-600 hover:bg-slate-50 transition-colors"
          onClick={handleOpenDirection}
          title="Tìm đường"
        >
          <i className="fa-solid fa-route text-lg" aria-hidden="true" />
        </button>
      )}

      {mode === 'browse' && selectedPlace && (
        <div className="absolute z-20 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 bottom-0 md:bottom-8 w-auto md:w-[360px] bg-white md:rounded-2xl rounded-t-3xl shadow-[0_-6px_24px_rgba(0,0,0,0.15)] md:shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-4 flex flex-col gap-2">
          <h3 className="m-0 text-lg font-semibold text-slate-800">{selectedPlace.display}</h3>
          <p className="m-0 text-[14px] text-slate-500">{selectedPlace.address}</p>
          <div className="flex gap-2 mt-2">
            <button 
              type="button" 
              className="flex-1 bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors" 
              onClick={handleOpenDirection}
            >
              <i className="fa-solid fa-route mr-2"></i> Chỉ đường
            </button>
            <button 
              type="button" 
              className="flex-1 bg-slate-100 text-slate-700 font-medium py-2.5 rounded-lg hover:bg-slate-200 transition-colors"
              onClick={() => {
                setSelectedPlace(null);
                setSearchQuery('');
                if (placeMarkerRef.current) {
                  placeMarkerRef.current.remove();
                  placeMarkerRef.current = null;
                }
              }}
            >
               Tắt
            </button>
          </div>
        </div>
      )}

      {/* Map Style Controls */}
      <div className={`absolute z-40 flex flex-col gap-1.5 md:gap-2 bg-white p-1.5 rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.16)] transition-all duration-300 ${
        mode === 'route' 
          ? 'top-4 right-3 md:top-24 md:right-4' 
          : (selectedPlace ? 'bottom-[max(184px,calc(env(safe-area-inset-bottom)+176px))] right-3 md:bottom-8 md:left-4 md:right-auto' : 'bottom-[max(24px,calc(env(safe-area-inset-bottom)+12px))] right-3 md:bottom-8 md:left-4 md:right-auto')
      }`}>
        <button 
          className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${tilemapStyle === 'vectorDefault' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`} 
          onClick={() => handleChangeTilemapStyle('vectorDefault')}
        >
          Vector
        </button>
        <button 
          className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${tilemapStyle === 'satellite' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`} 
          onClick={() => handleChangeTilemapStyle('satellite')}
        >
          Raster
        </button>
        <button 
          className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${showTraffic ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} 
          onClick={() => setShowTraffic(!showTraffic)}
        >
          Giao thông
        </button>
      </div>
      
    </div>
  )
}
