-- GameAccess clients authenticate through FastAPI access keys.
-- Database sessions are server-only (postgres owner / service role).
-- No public Data API grant is needed for these operational or legacy tables.
-- No rows are deleted, and server-owner access is preserved.
ALTER TABLE public.leasecredentialgrant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clienterrorreport ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaseruntimestate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accessevent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_game ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linkvertisecompletion ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
    public.leasecredentialgrant, public.clienterrorreport,
    public.leaseruntimestate, public.accessevent,
    public.digital_game, public.linkvertisecompletion
FROM anon, authenticated, PUBLIC;
