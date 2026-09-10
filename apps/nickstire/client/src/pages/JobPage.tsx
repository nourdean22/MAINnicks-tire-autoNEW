/**
 * One job. One URL. One JobPosting.
 *
 * Replaces the production arrangement verified in a browser on 2026-09-10:
 * three JobPosting objects on the single /careers URL, with the three role
 * slugs existing only as schema `identifier` values — /careers/automotive-
 * technician returned the 404 page. Google requires the markup to sit on the
 * most detailed leaf page for a SINGLE job and not on a list page.
 *
 * The form is rendered ON this page and submits straight to candidates.submit,
 * which is what makes `directApply: true` in the schema a true statement. If
 * applying ever routes somewhere else, that flag has to change with it.
 */
import { useRoute, Link } from "wouter";
import { ArrowLeft, CheckCircle2, MapPin } from "lucide-react";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { BUSINESS, SITE_URL } from "@shared/business";
import {
  buildJobPostingSchema,
  jobOpeningBySlug,
  jobOpeningPath,
} from "@shared/jobOpenings";
import { ApplicationForm } from "./Careers";
import NotFound from "./NotFound";

export default function JobPage() {
  const [, params] = useRoute("/careers/:slug");
  const job = params?.slug ? jobOpeningBySlug(params.slug) : undefined;

  // A filled or closed role must not keep serving a live posting. 404 is the
  // correct answer: the job genuinely no longer exists at this URL, and the
  // Indexing API removal notification says the same thing to Google.
  if (!job || job.status !== "open") return <NotFound />;

  const schema = buildJobPostingSchema(job, {
    siteUrl: SITE_URL,
    orgName: BUSINESS.name,
    logoUrl: `${SITE_URL}/favicon.ico`,
    address: {
      street: BUSINESS.address.street,
      city: BUSINESS.address.city,
      state: BUSINESS.address.state,
      zip: BUSINESS.address.zip,
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`${job.title} — ${BUSINESS.address.city}, ${BUSINESS.address.state} | ${BUSINESS.name}`}
        description={job.description.slice(0, 155)}
        canonicalPath={jobOpeningPath(job.slug)}
      />
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
      <LocalBusinessSchema />
      <Breadcrumbs items={[{ label: "Careers", href: "/careers" }, { label: job.title }]} />

      <section className="pt-28 pb-16 lg:pt-36 border-b border-border/20">
        <div className="container max-w-3xl">
          <Link
            href="/careers"
            className="inline-flex items-center gap-2 text-[13px] text-foreground/50 hover:text-foreground/80 mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> All open roles
          </Link>

          <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-primary mb-3">
            {job.type} · {job.level}
          </p>
          <h1 className="font-heading text-4xl lg:text-5xl font-extrabold uppercase text-foreground mb-5">
            {job.title}
          </h1>
          <p className="flex items-center gap-2 text-[13px] text-foreground/50 mb-6">
            <MapPin className="w-4 h-4" />
            {BUSINESS.address.street}, {BUSINESS.address.city}, {BUSINESS.address.state}
          </p>
          <p className="text-base text-foreground/70 leading-relaxed">{job.description}</p>
        </div>
      </section>

      <section className="py-14">
        <div className="container max-w-3xl grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-heading text-lg font-extrabold uppercase text-foreground mb-4">
              What you'll do
            </h2>
            <ul className="space-y-2.5">
              {job.responsibilities.map((r) => (
                <li key={r} className="flex gap-2.5 text-[14px] text-foreground/70">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-heading text-lg font-extrabold uppercase text-foreground mb-4">
              What we need
            </h2>
            <ul className="space-y-2.5">
              {job.requirements.map((r) => (
                <li key={r} className="flex gap-2.5 text-[14px] text-foreground/70">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            {job.nice.length > 0 && (
              <>
                <h3 className="font-heading text-[13px] font-extrabold uppercase text-foreground/60 mt-7 mb-3">
                  Nice to have
                </h3>
                <ul className="space-y-2">
                  {job.nice.map((n) => (
                    <li key={n} className="text-[13px] text-foreground/50">
                      {n}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="py-14 border-t border-border/20">
        <div className="container max-w-2xl">
          <h2 className="font-heading text-2xl font-extrabold uppercase text-foreground mb-6">
            Apply for {job.title}
          </h2>
          <ApplicationForm />
        </div>
      </section>
    </div>
  );
}
