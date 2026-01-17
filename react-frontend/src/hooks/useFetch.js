import { useEffect, useState } from 'react'
import apiClient from '@services/apiClient'

export default function useFetch(url, { method = 'get', params, body, headers, skip = false } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (skip || !url) return
    let active = true
    setLoading(true)
    setError(null)
    apiClient({ url, method, params, data: body, headers })
      .then((res) => { if (active) setData(res.data) })
      .catch((e) => { if (active) setError(e) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [url, method, JSON.stringify(params), JSON.stringify(headers), JSON.stringify(body), skip])

  return { data, loading, error, setData }
}
