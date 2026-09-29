import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Where website forms are posted.
 *
 * Public: anybody on the internet can reach it, so it trusts nothing it is
 * sent. The form is found by its key; the website posting it must be one the
 * form lists (when it lists any); a hidden field catches robots; and each
 * visitor is limited to five submissions a form in ten minutes. What to do
 * with the person - a new prospect, or a touch on someone already on file -
 * is decided in the database by web_form_submit().
 *
 * Answers the embed script (lib: /api/forms/script) with JSON, and a plain
 * HTML form - one on a page with scripts off - with a thank-you page or a
 * redirect.
 */

export const dynamic = "force-dynamic";

const FIELD_KEYS = ["firstName", "lastName", "email", "phone", "companyName", "jobTitle", "website", "city", "country", "message"];
const TOUCH_KEYS = ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "landingPage", "referrer", "at"];

interface FormConfig {
  allowedOrigins: string[];
  thankYouUrl: string | null;
  thankYouMessage: string;
  active: boolean;
}

async function loadForm(key: string): Promise<FormConfig | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return null;
  const { data } = await supabaseAdmin()
    .from("web_form")
    .select("allowedOrigins, thankYouUrl, thankYouMessage, active")
    .eq("formKey", key)
    .maybeSingle();
  return (data as FormConfig | null) ?? null;
}

function originAllowed(form: FormConfig, origin: string | null): boolean {
  if (form.allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return form.allowedOrigins.some((o) => o.replace(/\/+$/, "").toLowerCase() === origin.toLowerCase());
}

function cors(origin: string | null, form: FormConfig | null): Record<string, string> {
  if (!origin || !form || !originAllowed(form, origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function cleanTouch(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const k of TOUCH_KEYS) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 500);
  }
  if (out.at && Number.isNaN(Date.parse(out.at))) delete out.at;
  return out;
}

function thankYouPage(message: string): Response {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title>` +
      `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0 16px"><p style="font-size:18px;text-align:center">${safe}</p></body>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const form = await loadForm(key);
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin"), form) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const origin = request.headers.get("origin");
  const form = await loadForm(key);
  const headers = cors(origin, form);
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");

  const reply = (status: number, body: Record<string, unknown>) =>
    NextResponse.json(body, { status, headers });

  if (!form || !form.active) return reply(404, { ok: false, error: "This form is not accepting submissions." });
  if (!originAllowed(form, origin)) return reply(403, { ok: false, error: "This form cannot be sent from this website." });

  let raw: Record<string, unknown> = {};
  try {
    if (isJson) {
      raw = (await request.json()) as Record<string, unknown>;
    } else {
      const fd = await request.formData();
      fd.forEach((v, k) => {
        if (typeof v === "string") raw[k] = v;
      });
      if (typeof raw._touch === "string") {
        try {
          raw._touch = JSON.parse(raw._touch as string);
        } catch {
          raw._touch = {};
        }
      }
    }
  } catch {
    return reply(400, { ok: false, error: "The form could not be read." });
  }

  const data: Record<string, string> = {};
  for (const k of FIELD_KEYS) {
    const v = raw[k];
    if (typeof v === "string") data[k] = v.slice(0, k === "message" ? 4000 : 255);
  }
  const touchIn = (raw._touch ?? {}) as { first?: unknown; latest?: unknown };
  const touch = { first: cleanTouch(touchIn.first), latest: cleanTouch(touchIn.latest) };
  const spam = typeof raw._gotcha === "string" && raw._gotcha.trim() !== "";

  const ip = (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "").split(",")[0]?.trim() || "unknown";
  const ipHash = createHash("sha256").update(`${ip}|${key}`).digest("hex");

  const { data: result, error } = await supabaseAdmin().rpc("web_form_submit", {
    p_form_key: key,
    p_data: data,
    p_touch: touch,
    p_ip_hash: ipHash,
    p_spam: spam,
  });
  if (error) return reply(500, { ok: false, error: "Something went wrong. Please try again." });

  const outcome = (result as { outcome?: string; field?: string } | null)?.outcome;
  if (outcome === "INVALID") {
    const field = (result as { field?: string }).field;
    return reply(400, { ok: false, error: field === "email" ? "Please give a valid email address." : "Please fill in the required fields.", field });
  }
  if (outcome === "RATE_LIMITED") return reply(429, { ok: false, error: "Too many submissions. Please try again in a few minutes." });
  if (outcome === "NOT_FOUND") return reply(404, { ok: false, error: "This form is not accepting submissions." });

  // Spam is answered like success, so a robot learns nothing.
  if (isJson) return reply(200, { ok: true, message: form.thankYouMessage, redirect: form.thankYouUrl });
  if (form.thankYouUrl) return NextResponse.redirect(form.thankYouUrl, { status: 303, headers });
  return thankYouPage(form.thankYouMessage);
}
