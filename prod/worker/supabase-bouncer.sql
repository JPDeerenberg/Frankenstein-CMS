-- Frankenstein CMS: Multi-tenant Sites Table
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_email TEXT UNIQUE NOT NULL,
    site_password TEXT NOT NULL,
    github_token TEXT NOT NULL,
    github_owner TEXT NOT NULL,
    github_repo TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

-- Important: We don't want clients to be able to query this table directly via the API.
-- The Edge Function will access it using the service_role key (bypassing RLS).
-- So we leave it with default RLS (deny all) for now.

-- If you want to allow manual edits via the Supabase dashboard but hide it from the public API:
-- CREATE POLICY "Deny all public access" ON public.sites FOR ALL TO public USING (false);
