// Kafene's browser SDK, loaded on demand only (never in index.html). Mirrors the loader in
// Kafene's own WooCommerce plugin (assets/js/kafene.js v2.0.0): a stylesheet plus
// sdk.kafene.com/plugin/js/kafene.js, ready when the global `kafene.init` exists or the
// `kafenejs-init` event fires. Unlike the plugin, this rejects instead of waiting forever.

const SDK_BASE = "https://sdk.kafene.com/";
const KAFENE_SCRIPT_SRC = `${SDK_BASE}plugin/js/kafene.js`;
const KAFENE_CSS_HREF = `${SDK_BASE}plugin/css/kafene.css`;

export type KafeneItem = {
  model: string;
  description: string;
  price: number; // per unit, dollars
  quantity: number;
  condition: string;
  damage: string;
  leasable: boolean;
};

export type KafeneResult = { status: "completed" | "declined" | "cancelled" | "error"; message?: string };

export type KafeneFlow = {
  on(event: "approved" | "success" | "declined" | "failure", handler: (payload?: { uid?: string; message?: string }) => void): KafeneFlow;
  result: Promise<KafeneResult>;
};

export type KafeneSdk = {
  init(config: { apiKey: string; storeId: string; environment: "sandbox" | "production" }): {
    openCheckout(order: {
      orderId: string;
      items: KafeneItem[];
      shippingCost: number;
      customer?: { billing: Record<string, unknown>; shipping?: Record<string, unknown> };
    }): KafeneFlow;
  };
};

declare global {
  interface Window {
    kafene?: KafeneSdk;
  }
}

let pending: Promise<KafeneSdk> | null = null;

const ready = () => (typeof window.kafene?.init === "function" ? window.kafene : null);

export function loadKafeneSdk(timeoutMs = 10_000): Promise<KafeneSdk> {
  const now = ready();
  if (now) return Promise.resolve(now);
  if (pending) return pending;

  pending = new Promise<KafeneSdk>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${KAFENE_SCRIPT_SRC}"]`);
    const inserted = !script;

    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("kafenejs-init", check);
      script?.removeEventListener("load", check);
      script?.removeEventListener("error", onError);
    };
    const check = () => {
      const sdk = ready();
      if (!sdk) return;
      cleanup();
      resolve(sdk);
    };
    const fail = (message: string) => {
      cleanup();
      pending = null;
      // Drop a script we added so a retry starts clean.
      if (inserted) script?.remove();
      reject(new Error(message));
    };
    const onError = () => fail("Kafene SDK failed to load");
    const timer = setTimeout(() => fail("Kafene SDK timed out"), timeoutMs);

    document.addEventListener("kafenejs-init", check);
    if (!script) {
      if (!document.querySelector(`link[href="${KAFENE_CSS_HREF}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = KAFENE_CSS_HREF;
        document.head.appendChild(link);
      }
      script = document.createElement("script");
      script.src = KAFENE_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", check);
    script.addEventListener("error", onError);
  });
  return pending;
}
