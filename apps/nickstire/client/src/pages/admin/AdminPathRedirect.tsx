/**
 * /admin/<slug>[/<id>] -> /admin?tab=<section>[&<innerKey>=<value>][&id=<id>].
 *
 * 2026-10-19 (admin prune W1): StateNour links /admin/leads, /admin/callbacks,
 * /admin/quotes/new and /admin/leads/<id>, and every one of them fell through to
 * NotFound. The slug goes through the same resolver as ?tab=, so a path, a query
 * link, back/forward and the in-app event all land in the same place. An unknown
 * slug is passed on as ?tab=<slug>, so the admin says the link is bad instead of
 * quietly opening Today.
 *
 * Known limits: Sales Pipeline has no per-lead view, so /admin/leads/<id> lands
 * on the list (the id rides along as ?id=). /admin/quotes/new lands on Sales
 * Pipeline, whose header holds the Walk-in quote button; nothing opens the quote
 * drawer from a URL today.
 */
import { Redirect, useParams } from "wouter";
import { navTargetSearch, resolveNavTarget } from "./registry";

const PATH_SLUGS: Record<string, string> = { quotes: "leads" };

function adminPathTarget(rest: string): string {
  const [first = "", second = ""] = rest.split("/").filter(Boolean);
  const slug = PATH_SLUGS[first.toLowerCase()] ?? first;
  const target = resolveNavTarget(slug);
  const params = target ? navTargetSearch(target, new URLSearchParams()) : new URLSearchParams({ tab: slug });
  if (target && /^\d+$/.test(second)) params.set("id", second);
  return `/admin?${params.toString()}`;
}

export default function AdminPathRedirect() {
  const params = useParams<{ "*": string }>();
  return <Redirect to={adminPathTarget(params["*"] ?? "")} replace />;
}
