import { StandardPage } from "@/components/layout/standard-page";

// /proof's server reads used to run with a blank body (audit 02-X2); same header as the page, shared skeleton below.
export default function ProofLoading() {
  return <StandardPage eyebrow="System / proof" title="Proof" loading />;
}
