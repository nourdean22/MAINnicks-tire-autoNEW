/**
 * /terms — Terms and Conditions page for Nick's Tire & Auto.
 * Required for Twilio 10DLC compliance.
 * Includes program name, description, message/data rates, message frequency,
 * support contact info, and opt-out instructions (HELP and STOP).
 */
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

export default function Terms() {
  return (
    <PageLayout activeHref="/terms">
      <SEOHead
        title={`Terms & Conditions${BUSINESS.seo.titleSuffix}`}
        description="Terms and Conditions for Nick's Tire & Auto. Review our service terms, SMS messaging program details, and website usage policies."
        canonicalPath="/terms"
      />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-nick-dark pt-32 pb-16">
        <div className="container">
          <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Terms & Conditions" }]} />
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mt-6 tracking-tight">
            Terms & Conditions
          </h1>
          <p className="text-foreground/60 mt-4 text-lg max-w-2xl">
            Last updated: March 19, 2026
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="bg-nick-dark py-16">
        <div className="container max-w-3xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10 text-foreground/80 leading-relaxed">

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">1. Acceptance of Terms</h2>
              <p>
                By accessing or using the Nick's Tire & Auto website at{" "}
                <a href="https://nickstire.org" className="text-nick-yellow hover:underline">nickstire.org</a>,
                booking an appointment, or opting in to our SMS messaging program, you agree to be bound by these
                Terms and Conditions. If you do not agree, please do not use our website or services.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">2. Services</h2>
              <p>
                Nick's Tire & Auto provides automotive repair, tire sales and service, vehicle diagnostics, emissions
                testing, and related services at our shop located at {BUSINESS.address.full}. All services are
                performed by our trained technicians and are subject to vehicle inspection and diagnosis.
              </p>
              <p className="mt-3">
                Service estimates provided through our website (including the Price Estimator tool) are approximate
                and may vary based on actual vehicle condition. Final pricing is determined after in-person inspection.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">3. Appointments and Bookings</h2>
              <p>
                Online appointment requests submitted through our website are requests only and do not guarantee a
                specific time slot. Our team will confirm your appointment and contact you with scheduling details.
                We operate on a first-come, first-served basis.
              </p>
              <p className="mt-3">
                If you need to cancel or reschedule, please contact us at {BUSINESS.phone.display} as soon as possible.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">4. SMS Text Messaging Program</h2>
              <div className="p-6 bg-card/50 border border-border/30 rounded-sm mb-6">
                <p className="font-bold text-foreground text-lg mb-3">Program Details</p>
                <ul className="list-disc pl-6 space-y-2">
                  <li><strong className="text-foreground">Program Name:</strong> Nick's Tire & Auto Service Notifications</li>
                  <li><strong className="text-foreground">Description:</strong> Service reminders, appointment confirmations, maintenance tips, repair status updates, and promotional offers from Nick's Tire & Auto</li>
                  <li><strong className="text-foreground">Message Frequency:</strong> Message frequency varies. You may receive up to 8 messages per month depending on your service history and preferences</li>
                  <li><strong className="text-foreground">Message & Data Rates:</strong> Message and data rates may apply. Contact your mobile carrier for details about your text messaging plan</li>
                </ul>
              </div>

              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Opt-In</h3>
              <p>
                You may opt in to receive SMS messages from Nick's Tire & Auto by providing your phone number at
                our shop, through our website contact or booking forms, or by texting <strong className="text-foreground">START</strong> to
                our business number. By opting in, you consent to receive recurring automated text messages from
                Nick's Tire & Auto at the phone number you provided.
              </p>

              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Opt-Out</h3>
              <p>
                You can opt out of receiving SMS messages at any time by texting <strong className="text-nick-yellow text-xl">STOP</strong> to
                any message you receive from us. You will receive a confirmation message and will no longer receive
                text messages from Nick's Tire & Auto. You may also opt out by calling us at {BUSINESS.phone.display}.
              </p>

              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Help</h3>
              <p>
                For help with our SMS program, text <strong className="text-nick-yellow text-xl">HELP</strong> to
                any message from us, or contact us directly:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>Phone: <a href={BUSINESS.phone.href} className="text-nick-yellow hover:underline">{BUSINESS.phone.display}</a></li>
                <li>Visit: {BUSINESS.address.full}</li>
                <li>Hours: {BUSINESS.hours.display}</li>
              </ul>

              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Supported Carriers</h3>
              <p>
                Our SMS program is compatible with all major US mobile carriers including AT&T, Verizon, T-Mobile,
                Sprint, and most regional carriers. Carriers are not liable for delayed or undelivered messages.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">5. Website Use</h2>
              <p>
                You agree to use our website for lawful purposes only. You may not use our website to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Submit false or misleading information</li>
                <li>Interfere with the website's operation or security</li>
                <li>Attempt to gain unauthorized access to any part of the website</li>
                <li>Use automated tools to scrape or collect data from the website</li>
                <li>Engage in any activity that could harm Nick's Tire & Auto or its customers</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">6. Intellectual Property</h2>
              <p>
                All content on this website, including text, images, logos, and design elements, is the property
                of Nick's Tire & Auto and is protected by applicable intellectual property laws. You may not
                reproduce, distribute, or create derivative works from our content without written permission.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">7. Disclaimer of Warranties</h2>
              <p>
                Our website and online tools (including the diagnostic tool, price estimator, and AI chat assistant)
                are provided "as is" for informational purposes only. They are not a substitute for professional
                in-person vehicle inspection and diagnosis. Nick's Tire & Auto makes no warranties regarding the
                accuracy or completeness of information provided through these online tools.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">8. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, Nick's Tire & Auto shall not be liable for any indirect,
                incidental, special, or consequential damages arising from your use of our website or reliance on
                information provided through our online tools. Our total liability for any claim related to our
                website shall not exceed the amount you paid for services, if any.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">9. Privacy</h2>
              <p>
                Your use of our website and services is also governed by our{" "}
                <a href="/privacy-policy" className="text-nick-yellow hover:underline">Privacy Policy</a>,
                which describes how we collect, use, and protect your personal information.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">10. Changes to Terms</h2>
              <p>
                We reserve the right to update these Terms and Conditions at any time. Changes will be posted on
                this page with an updated "Last updated" date. Your continued use of our website or services after
                changes are posted constitutes acceptance of the updated terms.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">11. Governing Law</h2>
              <p>
                These Terms and Conditions are governed by the laws of the State of Ohio. Any disputes arising
                from these terms shall be resolved in the courts of Cuyahoga County, Ohio.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">12. Contact Us</h2>
              <p>
                If you have questions about these Terms and Conditions, please contact us:
              </p>
              <div className="mt-4 p-6 bg-card/50 border border-border/30 rounded-sm">
                <p className="font-bold text-foreground">{BUSINESS.name}</p>
                <p>{BUSINESS.address.full}</p>
                <p>Phone: <a href={BUSINESS.phone.href} className="text-nick-yellow hover:underline">{BUSINESS.phone.display}</a></p>
                <p>Website: <a href="https://nickstire.org" className="text-nick-yellow hover:underline">nickstire.org</a></p>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
