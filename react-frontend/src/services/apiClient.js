import axios from 'axios'
import { API_BASE_URL } from '@utils/constants'
import { storage } from '@utils/storage'

const instance = axios.create({ baseURL: API_BASE_URL })

instance.interceptors.request.use((config) => {
  const token = storage.get('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

instance.interceptors.response.use(
  (res) => res,
  (err) => {
    // Surface backend validation errors consistently
    const message = err?.response?.data?.message || err.message
    return Promise.reject(new Error(message))
  },
)

export default instance
