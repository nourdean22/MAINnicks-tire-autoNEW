export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  // Section 5.3 (2026-09-08): a header is a row with a divider, not a glass card. The
  // nested card + drop shadow + fade-in entrance sat on top of every page's own cards.
  return (
    <div className="flex flex-col gap-4 border-b border-edge pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="section-label text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-3xl md:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
