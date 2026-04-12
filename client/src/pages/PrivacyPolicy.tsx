/**
 * /privacy-policy — Privacy Policy page for Nick's Tire & Auto.
 * Required for Twilio 10DLC compliance and general business transparency.
 */
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { BUSINESS } from "@shared/business";
import { SHORT_DISCLAIMERS } from "@shared/disclaimers";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

export default function PrivacyPolicy() {
  return (
    <PageLayout activeHref="/privacy-policy">
      <SEOHead
        title={`Privacy Policy${BUSINESS.seo.titleSuffix}`}
        description="Privacy Policy for Nick's Tire & Auto. Learn how we collect, use, and protect your personal information when you use our services or visit our website."
        canonicalPath="/privacy-policy"
      />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-background pt-32 pb-16">
        <div className="container">
          <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Privacy Policy" }]} />
          <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mt-6 tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-foreground/60 mt-4 text-lg max-w-2xl">
            Last updated: March 19, 2026
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="bg-background py-16">
        <div className="container max-w-3xl">
          <div className="prose prose-invert prose-lg max-w-none space-y-10 text-foreground/80 leading-relaxed">

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">1. Introduction</h2>
              <p>
                Nick's Tire & Auto ("we," "us," or "our") operates the website at{" "}
                <a href="https://nickstire.org" className="text-primary hover:underline">nickstire.org</a>{" "}
                and provides automotive repair and tire services at our shop located at {BUSINESS.address.full}.
                This Privacy Policy describes how we collect, use, and protect your personal information when you
                visit our website, use our services, or communicate with us.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">2. Information We Collect</h2>
              <p>We may collect the following types of information:</p>
              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Information You Provide</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Name, phone number, and email address when you schedule a drop-off, submit a contact form, or request a callback</li>
                <li>Vehicle information (year, make, model, mileage) when you use our booking or diagnostic tools</li>
                <li>Service history and preferences when you create a My Garage account</li>
                <li>Phone number when you opt in to receive SMS text messages</li>
                <li>Any other information you voluntarily provide through our website or in person at our shop</li>
              </ul>
              <h3 className="text-xl font-semibold text-foreground mt-6 mb-3">Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Browser type, device type, and operating system</li>
                <li>IP address and approximate geographic location</li>
                <li>Pages visited, time spent on pages, and referring URLs</li>
                <li>Cookies and similar tracking technologies for website functionality and analytics</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Process and manage your service appointments and requests</li>
                <li>Communicate with you about your vehicle service, including appointment confirmations, status updates, and follow-ups</li>
                <li>Send service reminders and maintenance notifications via SMS text message (with your consent)</li>
                <li>Respond to your inquiries and provide customer support</li>
                <li>Improve our website, services, and customer experience</li>
                <li>Send promotional offers and seasonal maintenance tips (with your consent)</li>
                <li>Comply with legal obligations</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">4. SMS Text Messaging</h2>
              <p>
                If you opt in to receive SMS text messages from Nick's Tire & Auto, we will use your phone number
                to send you service reminders, appointment updates, maintenance tips, and promotional offers.
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Message frequency varies based on your service history and preferences</li>
                <li>Message and data rates may apply depending on your mobile carrier</li>
                <li>You can opt out at any time by replying <strong className="text-foreground">STOP</strong> to any message</li>
                <li>For help, reply <strong className="text-foreground">HELP</strong> or call us at {BUSINESS.phone.display}</li>
                <li>We will not share your phone number with third parties for marketing purposes</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">5. Information Sharing</h2>
              <p>
                We do not sell, trade, or rent your personal information to third parties. We may share your
                information only in the following limited circumstances:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className="text-foreground">Service providers:</strong> We use trusted third-party services (such as Twilio for SMS messaging, Google for analytics and maps) that process data on our behalf under strict confidentiality agreements</li>
                <li><strong className="text-foreground">Legal requirements:</strong> We may disclose information when required by law, court order, or government regulation</li>
                <li><strong className="text-foreground">Business protection:</strong> We may share information to protect the rights, property, or safety of Nick's Tire & Auto, our customers, or others</li>
              </ul>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">6. Data Security</h2>
              <p>
                We implement reasonable technical and organizational measures to protect your personal information
                against unauthorized access, alteration, disclosure, or destruction. These measures include encrypted
                data transmission (HTTPS), secure database storage, and access controls limiting who can view your information.
              </p>
              <p className="mt-3">
                However, no method of electronic transmission or storage is 100% secure. While we strive to protect
                your information, we cannot guarantee absolute security.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">7. Limitation of Liability</h2>
              <p className="text-xs text-foreground/50 leading-relaxed">{SHORT_DISCLAIMERS.liability}</p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">8. Cookies</h2>
              <p>
                Our website uses cookies and similar technologies to enhance your browsing experience, analyze
                website traffic, and understand how visitors interact with our site. You can control cookie
                preferences through your browser settings. Disabling cookies may affect some website functionality.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">9. Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Request access to the personal information we hold about you</li>
                <li>Request correction of inaccurate information</li>
                <li>Request deletion of your personal information (subject to legal retention requirements)</li>
                <li>Opt out of SMS text messages at any time by replying STOP</li>
                <li>Opt out of promotional communications</li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, contact us at {BUSINESS.phone.display} or visit our shop at {BUSINESS.address.full}.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">10. Children's Privacy</h2>
              <p>
                Our website and services are not directed to individuals under the age of 16. We do not knowingly
                collect personal information from children. If you believe we have inadvertently collected information
                from a child, please contact us and we will promptly delete it.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">11. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. Any changes will be posted on this page with
                an updated "Last updated" date. We encourage you to review this policy periodically.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">12. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy or our data practices, please contact us:
              </p>
              <div className="mt-4 p-6 bg-card/50 border border-border/30 rounded-sm">
                <p className="font-bold text-foreground">{BUSINESS.name}</p>
                <p>{BUSINESS.address.full}</p>
                <p>Phone: <a href={BUSINESS.phone.href} className="text-primary hover:underline">{BUSINESS.phone.display}</a></p>
                <p>Website: <a href="https://nickstire.org" className="text-primary hover:underline">nickstire.org</a></p>
              </div>
            </div>

          </div>
        </div>
      </section>
    </PageLayout>
  );
}
