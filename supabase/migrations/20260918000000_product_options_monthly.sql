ALTER TYPE public."BillingType" ADD VALUE IF NOT EXISTS 'MONTHLY';

CREATE TABLE public.product_option (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('category', 'unit')),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100 AND (kind <> 'unit' OR length(name) <= 30)),
  key text GENERATED ALWAYS AS (
    regexp_replace(lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')), '^license$', 'licence')
  ) STORED,
  UNIQUE (kind, key)
);
ALTER TABLE public.product_option ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_option_read ON public.product_option FOR SELECT TO authenticated USING (app_is_internal());
CREATE POLICY product_option_insert ON public.product_option FOR INSERT TO authenticated WITH CHECK (app_can_write());
GRANT SELECT, INSERT ON public.product_option TO authenticated;
GRANT ALL ON public.product_option TO service_role;

INSERT INTO public.product_option (kind, name) VALUES
 ('category','Software'), ('category','Hardware'), ('category','Consulting'),
 ('category','Implementation'), ('category','Support'), ('category','Training'),
 ('category','Hosting'), ('category','Subscription'),
 ('unit','Each'), ('unit','User'), ('unit','Licence'), ('unit','Device'),
 ('unit','Hour'), ('unit','Day'), ('unit','Month'), ('unit','Year'), ('unit','Project'), ('unit','Session')
ON CONFLICT (kind, key) DO NOTHING;

INSERT INTO public.product_option (kind, name)
 SELECT 'category', btrim(category) FROM public.product WHERE nullif(btrim(category), '') IS NOT NULL
ON CONFLICT (kind, key) DO NOTHING;
INSERT INTO public.product_option (kind, name)
 SELECT 'unit', btrim("unitOfMeasure") FROM public.product WHERE nullif(btrim("unitOfMeasure"), '') IS NOT NULL
ON CONFLICT (kind, key) DO NOTHING;
