// const API = import.meta.env.VITE_API_URL || 'https://meditrack-hdfm.onrender.com'
const API = import.meta.env.VITE_API_URL
async function request(path, options = {}) {
  const token = localStorage.getItem('token')
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  let res
  try {
    res = await fetch(`${API}${path}`, { ...options, headers })
  } catch {
    throw new Error('Cannot connect to the backend. Start FastAPI on port 8000.')
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.dispatchEvent(new Event('auth-expired'))
    }
    throw new Error(data.detail || `Request failed (${res.status})`)
  }

  return data
}

export const health = () => request('/api/health')
export const register = d => request('/api/auth/register', { method: 'POST', body: JSON.stringify(d) })
export const login = d => request('/api/auth/login', { method: 'POST', body: JSON.stringify(d) })
export const me = () => request('/api/auth/me')
export const meds = () => request('/api/medications')
export const addMed = d => request('/api/medications', { method: 'POST', body: JSON.stringify(d) })
export const updateMed = (id, d) => request(`/api/medications/${id}`, { method: 'PUT', body: JSON.stringify(d) })
export const deleteMed = id => request(`/api/medications/${id}`, { method: 'DELETE' })
export const takeMed = id => request(`/api/medications/${id}/taken`, { method: 'POST' })
export const adherence = () => request('/api/adherence')
export const notifications = () => request('/api/notifications')
export const readNotification = id => request(`/api/notifications/${id}/read`, { method: 'POST' })
export const readAllNotifications = () => request('/api/notifications/read-all', { method: 'POST' })

export const uploadPrescription = file => {
  const fd = new FormData()
  fd.append('file', file)
  return request('/api/prescription/upload', { method: 'POST', body: fd })
}
