import api from './apiClient'
import { endpoints } from './endpoints'

export async function login(payload) {
  const { data } = await api.post(endpoints.auth.login, payload)
  return data
}

export async function register(payload) {
  const { data } = await api.post(endpoints.auth.register, payload)
  return data
}

export async function me() {
  const { data } = await api.get(endpoints.auth.me)
  return data
}
