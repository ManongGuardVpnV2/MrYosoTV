import { createClient } from '@supabase/supabase-js';


// Initialize database client
const supabaseUrl = 'https://jboemtbxqztibokysvjl.databasepad.com';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjYwNDQwYzJhLTcxMDQtNDU2ZC1iNDdhLTgwYTAwMDE4ZDVlYiJ9.eyJwcm9qZWN0SWQiOiJqYm9lbXRieHF6dGlib2t5c3ZqbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY4MzU3NzAwLCJleHAiOjIwODM3MTc3MDAsImlzcyI6ImZhbW91cy5kYXRhYmFzZXBhZCIsImF1ZCI6ImZhbW91cy5jbGllbnRzIn0.v-7Ukb6ocjjCIYvR7PsxiVtNR2oTF4wrWyMUhK5n37A';
const supabase = createClient(supabaseUrl, supabaseKey);


export { supabase };