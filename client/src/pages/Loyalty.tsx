import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import {
  Star, Gift, Trophy, ArrowRight,
  Zap, DollarSign, Clock, Shield,
} from "lucide-react";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const HOW_IT_WORKS = [
  { num: "01", icon: <Star className="w-6 h-6" />, title: "Earn Points", desc: "Earn 1 point per dollar spent on any service. Bonus points on select services." },
  { num: "02", icon: <Trophy className="w-6 h-6" />, title: "Track Progress", desc: "View your points balance and transaction history in your My Garage account." },
  { num: "03", icon: <Gift className="w-6 h-6" />, title: "Redeem Rewards", desc: "Cash in your points for discounts on future services. The more you earn, the bigger the reward." },
];

function LoyaltyDashboard() {
  const { data: summary, isLoading: summaryLoading } = trpc.loyalty.summary.useQuery(undefined, { staleTime: 2 * 60 * 1000 });
  const { data: transactions } = trpc.loyalty.transactions.useQuery(undefined, { staleTime: 2 * 60 * 1000 });
  const { data: rewards } = trpc.loyalty.rewards.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const utils = trpc.useUtils();

  const redeemMutation = trpc.loyalty.redeem.useMutation({
    onSuccess: () => {
      utils.loyalty.summary.invalidate();
      utils.loyalty.transactions.invalidate();
      toast.success("Reward redeemed! Show this to the front desk.");
    },
    onError: (err) => toast.error(err.message),
  });

  if (summaryLoading) {
    return (
      <div className="text-center py-12">
        <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-foreground/60 font-mono text-sm">Loading your rewards...</p>
      </div>
    );
  }

  const points = summary?.loyaltyPoints ?? 0;
  // Calculate lifetime earned from transactions or use current balance
  const lifetimePoints = transactions
    ? transactions.filter((t: any) => t.points > 0).reduce((sum: number, t: any) => sum + t.points, 0)
    : points;

  return (
    <div className="space-y-8">
      {/* Points Balance */}
      <div className="card-vibrant bg-card/80 rounded-lg p-6 lg:p-8 text-center">
        <span className="font-mono text-nick-teal text-xs tracking-widest uppercase">Your Balance</span>
        <div className="mt-3 flex items-center justify-center gap-3">
          <Star className="w-8 h-8 text-nick-yellow" />
          <span className="font-heading font-bold text-5xl lg:text-6xl text-nick-yellow">{points.toLocaleString()}</span>
          <span className="font-mono text-foreground/40 text-sm self-end mb-2">POINTS</span>
        </div>
        <p className="text-foreground/50 font-mono text-xs mt-3">
          Lifetime earned: {lifetimePoints.toLocaleString()} points
        </p>
      </div>

      {/* Available Rewards */}
      {rewards && rewards.length > 0 && (
        <div>
          <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-4">AVAILABLE REWARDS</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rewards.map((reward: any) => {
              const canRedeem = points >= reward.pointsCost;
              return (
                <div key={reward.id} className={`card-vibrant bg-card/80 rounded-lg p-5 border ${canRedeem ? "border-nick-teal/30" : "border-border/20 opacity-60"}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-heading font-bold text-foreground text-sm tracking-wider">{reward.title}</h4>
                      <p className="text-foreground/60 text-sm mt-1">{reward.description}</p>
                    </div>
                    <Gift className={`w-5 h-5 shrink-0 ${canRedeem ? "text-nick-teal" : "text-foreground/20"}`} />
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="font-mono text-sm text-nick-yellow font-bold">{reward.pointsCost} pts</span>
                    <button
                      onClick={() => {
                        if (canRedeem && !redeemMutation.isPending) {
                          redeemMutation.mutate({ rewardId: reward.id });
                        }
                      }}
                      disabled={!canRedeem || redeemMutation.isPending}
                      className={`px-4 py-2 rounded-md font-heading font-bold text-xs tracking-wider uppercase transition-colors ${
                        canRedeem
                          ? "bg-nick-teal text-white hover:bg-nick-teal/90"
                          : "bg-border/20 text-foreground/30 cursor-not-allowed"
                      }`}
                    >
                      {canRedeem ? "REDEEM" : `NEED ${(reward.pointsCost - points).toLocaleString()} MORE`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transaction History */}
      {transactions && transactions.length > 0 && (
        <div>
          <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-4">RECENT ACTIVITY</h3>
          <div className="card-vibrant bg-card/80 rounded-lg overflow-hidden">
            {transactions.slice(0, 10).map((tx: any, i: number) => (
              <div key={tx.id} className={`flex items-center justify-between px-5 py-3.5 ${i > 0 ? "border-t border-border/20" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.points > 0 ? "bg-nick-teal/20 text-nick-teal" : "bg-nick-yellow/20 text-nick-yellow"}`}>
                    {tx.points > 0 ? <Zap className="w-4 h-4" /> : <Gift className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-mono text-sm text-foreground">{tx.description}</p>
                    <p className="font-mono text-xs text-foreground/40">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className={`font-heading font-bold text-sm ${tx.points > 0 ? "text-nick-teal" : "text-nick-yellow"}`}>
                  {tx.points > 0 ? "+" : ""}{tx.points}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Loyalty() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <PageLayout activeHref="/rewards">
      <SEOHead
        title="Rewards Program | Nick's Tire & Auto — Cleveland, OH"
        description="Earn points on every service at Nick's Tire & Auto. Redeem for discounts on future repairs. Cleveland's most rewarding auto shop."
        canonicalPath="/rewards"
      />
      <Breadcrumbs items={[{ label: "Rewards", href: "/rewards" }]} />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="section-dark pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Loyalty Rewards</span>
          <h1 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            EARN <span className="text-gradient-yellow">REWARDS</span> ON EVERY SERVICE
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto">
            Every dollar you spend at Nick's Tire & Auto earns you points toward future discounts. The more you service with us, the more you save.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="section-darker py-16 lg:py-20">
        <div className="container max-w-4xl">
          <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
            HOW IT WORKS
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.num} className="text-center">
                <span className="font-heading font-bold text-4xl text-border/40">{step.num}</span>
                <div className="w-12 h-12 mx-auto mt-3 mb-3 rounded-full bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                  {step.icon}
                </div>
                <h3 className="font-heading font-bold text-foreground tracking-wider text-sm mb-2">{step.title}</h3>
                <p className="text-foreground/60 text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard or Sign-In Prompt */}
      <section className="section-dark py-16 lg:py-20">
        <div className="container max-w-3xl">
          {loading ? (
            <div className="text-center py-12">
              <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : isAuthenticated ? (
            <LoyaltyDashboard />
          ) : (
            <div className="card-vibrant bg-card/80 rounded-lg p-8 text-center">
              <Trophy className="w-16 h-16 text-nick-yellow/60 mx-auto mb-4" />
              <h3 className="font-heading font-bold text-2xl text-foreground mb-3">
                SIGN IN TO VIEW YOUR REWARDS
              </h3>
              <p className="text-foreground/60 max-w-md mx-auto mb-6">
                Create a free My Garage account to start earning points on every service. Already have an account? Sign in to check your balance.
              </p>
              <a
                href={getLoginUrl()}
                className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
              >
                SIGN IN / CREATE ACCOUNT
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Benefits */}
      <section className="section-darker py-12 lg:py-16">
        <div className="container max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: <DollarSign className="w-6 h-6" />, title: "1 Point Per Dollar", desc: "Every dollar spent on services earns you 1 loyalty point." },
              { icon: <Shield className="w-6 h-6" />, title: "Points Never Expire", desc: "Your points stay in your account as long as you visit once a year." },
              { icon: <Clock className="w-6 h-6" />, title: "Instant Redemption", desc: "Redeem points at the counter on your next visit. No waiting." },
            ].map((b) => (
              <div key={b.title} className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                  {b.icon}
                </div>
                <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-1">{b.title}</h3>
                <p className="text-foreground/60 text-sm">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    
      <InternalLinks />
</PageLayout>
  );
}
