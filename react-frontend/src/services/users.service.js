import api from './apiClient'
import { endpoints } from './endpoints'

export async function list(params) {
  const res = await api.get(endpoints.users.base, { params })
  return res.data
}

export async function getById(id) {
  const res = await api.get(endpoints.users.byId(id))
  return res.data
}

export async function update(id, payload) {
  const res = await api.put(endpoints.users.byId(id), payload)
  return res.data
}
