// Fill these in with your own Supabase project's values.
// Find them in your Supabase dashboard: Project Settings -> API.
// The anon key is safe to expose in client code — Row Level Security
// policies on the tables are what actually protect each user's data.

window.SUPABASE_URL = 'https://rwedcajehdamvlsdjdjp.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3ZWRjYWplaGRhbXZsc2RqZGpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDg4MTAsImV4cCI6MjEwNTgyNDgxMH0.giZR0A_QqwkMNqe_KDqcj7Jp9MGyUIioTfc3FEFocHw';

// If the Supabase library failed to load (offline, blocked CDN), leave
// window.sb undefined so the pages can show a helpful message instead of
// crashing.
window.sb = window.supabase
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : undefined;
