// Shared: Supabase Auth session hook (anonymous or magic-link).
export function useAuth() {
  return { user: null, loading: true }
}
