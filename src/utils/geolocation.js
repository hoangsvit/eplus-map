/**
 * Lấy vị trí hiện tại của user
 * @returns {Promise} { lat, lng, accuracy }
 */
export const getCurrentLocation = () => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Thiết bị không hỗ trợ định vị GPS.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
      },
      (error) => {
        const errorMessages = {
          1: 'Người dùng từ chối quyền truy cập vị trí.',
          2: 'Không thể lấy vị trí. Vui lòng bật GPS.',
          3: 'Timeout lấy vị trí. Thử lại.',
        }
        reject(new Error(errorMessages[error.code] || 'Không thể lấy vị trí hiện tại.'))
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    )
  })
}

/**
 * Watch vị trí user (cập nhật liên tục)
 */
export const watchUserLocation = (onSuccess, onError) => {
  if (!navigator.geolocation) {
    onError(new Error('Thiết bị không hỗ trợ định vị GPS.'))
    return null
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      })
    },
    (error) => {
      onError(new Error('Lỗi theo dõi vị trí.'))
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    },
  )
}

/**
 * Dừng watch vị trí
 */
export const stopWatchingLocation = (watchId) => {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId)
  }
}
