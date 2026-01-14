import { createClient } from '@supabase/supabase-js';


// Initialize database client
const supabaseUrl = 'https://rgjbdalouaneehrknqqs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnamJkYWxvdWFuZWVocmtucXFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzODM2NjEsImV4cCI6MjA4Mzk1OTY2MX0.0mifRlDqheeVsWo78KBu0oSruZoMCmdRRTVs4epy43w';
const supabase = createClient(supabaseUrl, supabaseKey);


export { supabase };
