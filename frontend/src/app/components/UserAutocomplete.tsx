import { useEffect, useRef, useState } from 'react';
import { adminUsersAPI } from '../../services/api/adminUsers';
import { Input } from './ui/input';

interface UserOption {
  id: number;
  username: string;
  email: string;
}

interface UserAutocompleteProps {
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Search-as-you-type user picker — replaces raw numeric user-ID entry
 * (a real usability/error-proofing gap: admins had no way to confirm who
 * ID "412" actually is before submitting). Still just sets a plain user-ID
 * string via onChange, so it drops into any form that used to take a typed ID.
 */
export function UserAutocomplete({ value, onChange, placeholder = 'Search username or email…', className }: UserAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<UserOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // A caller can pass a pre-filled `value` (e.g. a "Suspend this user" deep
  // link carrying ?user=123) without ever going through select() — resolve
  // its label lazily so the picker doesn't silently show an empty search box
  // while still holding that id.
  useEffect(() => {
    if (!value || selectedLabel) return;
    let cancelled = false;
    adminUsersAPI.get(Number(value))
      .then((u) => { if (!cancelled) setSelectedLabel(`${u.username} (#${u.id})`); })
      .catch(() => { if (!cancelled) setSelectedLabel(`User #${value}`); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setOptions([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      adminUsersAPI.list({ search: query.trim(), page_size: 8 })
        .then((res) => setOptions(res.results))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const select = (u: UserOption) => {
    onChange(String(u.id));
    setSelectedLabel(`${u.username} (#${u.id})`);
    setQuery('');
    setOptions([]);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setSelectedLabel('');
    setQuery('');
  };

  if (value && selectedLabel) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className="flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm truncate">{selectedLabel}</span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0" onClick={clear}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`} ref={containerRef}>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {loading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matching users.</p>
          ) : (
            options.map((u) => (
              <button
                type="button"
                key={u.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                onClick={() => select(u)}
              >
                <span className="font-medium">{u.username}</span>
                <span className="text-muted-foreground"> · {u.email} · #{u.id}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
