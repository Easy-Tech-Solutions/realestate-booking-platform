import api from './apiClient'
import { endpoints } from './endpoints'

export async function list(params) {
  const res = await api.get(endpoints.listings.base, { params })
  return res.data
}

export async function getById(id) {
  const res = await api.get(endpoints.listings.byId(id))
  return res.data
}

export async function create(payload) {
  const res = await api.post(endpoints.listings.base, payload)
  return res.data
}

export async function toggleFavorite(id) {
  const res = await api.post(endpoints.listings.favorite(id))
  return res.data
}
