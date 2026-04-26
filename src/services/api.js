const API_BASE = 'https://maps.vietmap.vn'

export const apiService = {
  // Lấy gợi ý tìm kiếm
  async searchAutocomplete(query, focus, apiKey) {
    const params = new URLSearchParams({
      apikey: apiKey,
      text: query,
      focus,
      display_type: '5',
    })

    const response = await fetch(`${API_BASE}/api/autocomplete/v4?${params.toString()}`)
    if (!response.ok) throw new Error('Không thể tải gợi ý.')
    const data = await response.json()
    if (!Array.isArray(data)) return []

    // Enriched suggestions với địa chỉ cũ
    const self = this
    const enrichedData = await Promise.all(
      data.map(async (item) => {
        try {
          // Migrate address để lấy định dạng cũ
          const migrated = await self.migrateAddressNewToOld(item.display || item.address, apiKey)
          return {
            ...item,
            oldAddress: migrated.address,
            oldName: migrated.name,
          }
        } catch (err) {
          // Nếu migration thất bại, chỉ trả về suggestion ban đầu
          return {
            ...item,
            oldAddress: null,
            oldName: null,
          }
        }
      }),
    )

    return enrichedData
  },

  // Lấy chi tiết địa điểm theo ref_id
  async getPlaceDetail(refId, apiKey) {
    const params = new URLSearchParams({
      apikey: apiKey,
      refid: refId,
    })

    const response = await fetch(`${API_BASE}/api/place/v4?${params.toString()}`)
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
  },

  // Tìm kiếm theo text (Geocode v4)
  async searchGeocode(text, focus, apiKey) {
    const params = new URLSearchParams({
      apikey: apiKey,
      text: text,
      display_type: '1'
    })
    if (focus) params.append('focus', focus)

    const response = await fetch(`${API_BASE}/api/search/v4?${params.toString()}`)
    if (!response.ok) throw new Error('Không thể tìm kiếm địa điểm.')

    const data = await response.json()
    return Array.isArray(data) ? data : (data?.data || [])
  },

  // Lấy địa chỉ từ tọa độ (Reverse v4)
  async reverseGeocode(lat, lng, apiKey) {
    const params = new URLSearchParams({
      apikey: apiKey,
      lat: lat,
      lng: lng
    })

    const response = await fetch(`${API_BASE}/api/reverse/v4?${params.toString()}`)
    if (!response.ok) throw new Error('Không thể lấy địa chỉ từ tọa độ.')

    const data = await response.json()
    const results = Array.isArray(data) ? data : (data?.data || [])
    return results.length > 0 ? results[0] : null
  },

  // Lấy thông tin tuyến đường (hỗ trợ nhiều đường đi)
  async getRoute(points, vehicle, apiKey) {
    const routeVehicle = vehicle === 'car' ? 'car' : vehicle === 'motorcycle' ? 'motorcycle' : vehicle === 'foot' ? 'foot' : vehicle === 'bike' ? 'bike' : 'motorcycle'
    const params = new URLSearchParams({
      apikey: apiKey,
      vehicle: routeVehicle,
      points_encoded: 'false',
      alternatives: 'true',
      'ch.disable': 'true' // Bắt buộc để dùng alternatives
    })

    points.forEach(pt => {
      if (pt && pt.lat && pt.lng) {
        params.append('point', `${pt.lat},${pt.lng}`)
      }
    })

    const response = await fetch(`${API_BASE}/api/route/v4?${params.toString()}`)
    if (!response.ok) throw new Error('Không gọi được Route API.')

    const data = await response.json()
    if (data?.code && data.code !== 'OK') {
      throw new Error(data?.messages || `Route v4 lỗi: ${data.code}`)
    }

    if (!data.paths || data.paths.length === 0) throw new Error('Không có tuyến đường phù hợp.')

    // Trả về danh sách các đường đi
    return data.paths.map(path => ({
      points: path.points,
      distance: path.distance,
      time: path.time,
      instructions: Array.isArray(path.instructions) ? path.instructions : [],
    }))
  },

  // Lấy thông tin phí cao tốc (chỉ dành cho ô tô)
  async getRouteTolls(points, apiKey) {
    try {
      const coords = points.map(pt => [pt.lng, pt.lat])
      const response = await fetch(`${API_BASE}/api/route-tolls?api-version=1.1&apikey=${apiKey}&vehicle=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(coords),
      })

      if (!response.ok) return []

      const tollData = await response.json()
      const tollList = Array.isArray(tollData?.tolls)
        ? tollData.tolls
        : Array.isArray(tollData?.data?.tolls)
          ? tollData.data.tolls
          : []

      return tollList
    } catch {
      // Không chặn hiển thị tuyến đường nếu API phí cao tốc lỗi tạm thời
      return []
    }
  },

  // Tilemap Styles - Lấy URL của các kiểu bản đồ khác nhau
  getTilemapStyles(apiKey) {
    return {
      // Vector styles
      vectorDefault: `${API_BASE}/maps/styles/tm/style.json?apikey=${apiKey}`,
      vectorLight: `${API_BASE}/maps/styles/lm/style.json?apikey=${apiKey}`,
      vectorDark: `${API_BASE}/maps/styles/dm/style.json?apikey=${apiKey}`,
      vectorHybrid: `${API_BASE}/maps/styles/hm/style.json?apikey=${apiKey}`,

      // Traffic overlay
      traffic: `${API_BASE}/maps/styles/tf/style.json?apikey=${apiKey}`,

      // Satellite (Dùng Hybrid style vì nó chứa cả ảnh vệ tinh và nhãn)
      satellite: `${API_BASE}/maps/styles/hm/style.json?apikey=${apiKey}`,
    }
  },

  // Lấy URL một kiểu bản đồ cụ thể
  getTilemapStyleUrl(styleName, apiKey) {
    const styles = this.getTilemapStyles(apiKey)
    return styles[styleName] || styles.vectorDefault
  },

  // Chuyển đổi địa chỉ từ định dạng cũ sang mới (Migrate Address API)
  async migrateAddressOldToNew(addressText, focus = null, apiKey) {
    const params = new URLSearchParams({
      apikey: apiKey,
      text: addressText,
      migrate_type: 1,
    })

    if (focus) {
      params.append('focus', focus)
    }

    const response = await fetch(`${API_BASE}/api/migrate-address/v3?${params.toString()}`)
    if (!response.ok) throw new Error('Không thể chuyển đổi địa chỉ.')

    const data = await response.json()
    return {
      address: data.address || '',
      name: data.name || '',
      display: data.display || '',
      boundaries: Array.isArray(data.boundaries) ? data.boundaries : [],
    }
  },

  // Chuyển đổi địa chỉ từ định dạng mới sang cũ (Migrate Address API)
  async migrateAddressNewToOld(addressText, apiKey, focus = null) {
    const params = new URLSearchParams({
      apikey: apiKey,
      text: addressText,
      migrate_type: 2,
    })

    if (focus) {
      params.append('focus', focus)
    }

    const response = await fetch(`${API_BASE}/api/migrate-address/v3?${params.toString()}`)
    if (!response.ok) throw new Error('Không thể chuyển đổi địa chỉ.')

    const data = await response.json()
    return {
      address: data.address || '',
      name: data.name || '',
      display: data.display || '',
      boundaries: Array.isArray(data.boundaries) ? data.boundaries : [],
    }
  },
}
