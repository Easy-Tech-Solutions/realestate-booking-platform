import api from './apiClient'
import { endpoints } from './endpoints'

export async function list(params) {
  const res = await api.get(endpoints.bookings.base, { params })
  return res.data
}

export async function getById(id) {
  const res = await api.get(endpoints.bookings.byId(id))
  return res.data
}

export async function create(payload) {
  const res = await api.post(endpoints.bookings.base, payload)
  return res.data
}
