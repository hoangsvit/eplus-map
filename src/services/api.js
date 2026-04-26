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
    return Array.isArray(data) ? data : []
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

  // Lấy thông tin tuyến đường
  async getRoute(startLat, startLng, endLat, endLng, vehicle, apiKey) {
    const routeVehicle = vehicle === 'car' ? 'car' : vehicle === 'motorcycle' ? 'motorcycle' : 'motorcycle'
    const params = new URLSearchParams({
      apikey: apiKey,
      vehicle: routeVehicle,
      points_encoded: 'false',
    })
    params.append('point', `${startLat},${startLng}`)
    params.append('point', `${endLat},${endLng}`)

    const response = await fetch(`${API_BASE}/api/route/v3?${params.toString()}`)
    if (!response.ok) throw new Error('Không gọi được Route API.')

    const data = await response.json()
    if (data?.code && data.code !== 'OK') {
      throw new Error(data?.messages || `Route v3 lỗi: ${data.code}`)
    }

    const path = data?.paths?.[0]
    if (!path) throw new Error('Không có tuyến đường phù hợp.')

    return {
      points: path.points,
      distance: path.distance,
      time: path.time,
      instructions: Array.isArray(path.instructions) ? path.instructions : [],
    }
  },

  // Lấy thông tin phí cao tốc (chỉ dành cho ô tô)
  async getRouteTolls(startLng, startLat, endLng, endLat, apiKey) {
    try {
      const response = await fetch(`${API_BASE}/api/route-tolls?api-version=1.1&apikey=${apiKey}&vehicle=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([[startLng, startLat], [endLng, endLat]]),
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
}
