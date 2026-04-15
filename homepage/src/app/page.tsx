import { Navigation } from "@/components/landing/navigation";
import { HeroSection } from "@/components/landing/hero-section";
import { SocialProof } from "@/components/landing/social-proof";
import { FeaturesSection } from "@/components/landing/features-section";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { CtaSection } from "@/components/landing/cta-section";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <>
      <Navigation />
      <main>
        <HeroSection />
        <SocialProof />
        <FeaturesSection />
        <UseCasesSection />
        <TestimonialsSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
      <div className="grain-overlay" />
    </>
  );
}
