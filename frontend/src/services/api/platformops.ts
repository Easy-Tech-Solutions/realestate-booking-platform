import { fetchWithAuth } from './shared/client';

export interface FeatureFlag {
  id: number;
  key: string;
  name: string;
  description: string;
  is_enabled: boolean;
  updated_by: number | null;
  updated_by_username: string | null;
  updated_at: string;
  created_at: string;
}

export interface TaskHeartbeat {
  id: number;
  task_name: string;
  last_run_at: string | null;
  last_success: boolean | null;
  last_error: string;
  run_count: number;
}

export interface SystemHealth {
  database: { ok: boolean; error?: string };
  redis: { ok: boolean; error?: string };
  celery_workers: { ok: boolean; worker_count?: number; workers?: string[]; error?: string };
  disk: { ok: boolean; total_gb?: number; free_gb?: number; used_percent?: number; error?: string };
  recent_errors_last_hour: number;
  scheduled_tasks: TaskHeartbeat[];
}

export interface LogEntry {
  ts?: string;
  level?: string;
  logger?: string;
  msg?: string;
  raw?: string;
  [key: string]: unknown;
}

export interface MetricSnapshot {
  recorded_at: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  disk_used_percent: number;
  disk_free_gb: number;
  net_bytes_sent_mb: number;
  net_bytes_recv_mb: number;
}

export interface LiveMetrics extends Omit<MetricSnapshot, 'recorded_at'> {
  memory_total_mb: number;
}

export interface ServerMetrics {
  live: LiveMetrics;
  history: MetricSnapshot[];
}

export const platformOpsAPI = {
  listFeatureFlags: async (): Promise<FeatureFlag[]> => {
    return fetchWithAuth<FeatureFlag[]>('/api/platform-ops/feature-flags/');
  },

  createFeatureFlag: async (payload: { key: string; name: string; description?: string; is_enabled?: boolean }): Promise<FeatureFlag> => {
    return fetchWithAuth<FeatureFlag>('/api/platform-ops/feature-flags/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFeatureFlag: async (id: number, payload: Partial<{ name: string; description: string; is_enabled: boolean }>): Promise<FeatureFlag> => {
    return fetchWithAuth<FeatureFlag>(`/api/platform-ops/feature-flags/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteFeatureFlag: async (id: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/platform-ops/feature-flags/${id}/`, { method: 'DELETE' });
  },

  systemHealth: async (): Promise<SystemHealth> => {
    return fetchWithAuth<SystemHealth>('/api/platform-ops/system-health/');
  },

  recentErrors: async (limit = 100): Promise<LogEntry[]> => {
    return fetchWithAuth<LogEntry[]>(`/api/platform-ops/recent-errors/?limit=${limit}`);
  },

  serverMetrics: async (): Promise<ServerMetrics> => {
    return fetchWithAuth<ServerMetrics>('/api/platform-ops/server-metrics/');
  },

  logViewer: async (params: {
    file?: 'errors' | 'application' | 'activity' | 'transactions';
    limit?: number;
    level?: string;
    search?: string;
  } = {}): Promise<LogEntry[]> => {
    const qs = new URLSearchParams();
    if (params.file) qs.set('file', params.file);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.level) qs.set('level', params.level);
    if (params.search) qs.set('search', params.search);
    return fetchWithAuth<LogEntry[]>(`/api/platform-ops/log-viewer/?${qs.toString()}`);
  },
};
