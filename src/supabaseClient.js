import { createClient } from '@supabase/supabase-js'

// This pulls your keys from the .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// This creates the connection to your Survivor 50 database
export const supabase = createClient(supabaseUrl, supabaseAnonKey)