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
};
