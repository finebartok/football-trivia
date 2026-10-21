/**
 * The Edge Function entry point.
 *
 * The logic lives in ../_shared/, so the same code runs here under Deno
 * and under Node in the local runner.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleSubmitAnswer } from '../_shared/submit-answer.js';

Deno.serve((req) => handleSubmitAnswer(req, {
  createClient,
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
}));
