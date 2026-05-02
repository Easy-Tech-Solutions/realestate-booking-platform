import { useAppStore } from '../store/appStore';

export function useApp() {
  return useAppStore();
}
