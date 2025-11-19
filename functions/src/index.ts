/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import Stripe from "stripe";

admin.initializeApp();

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: For v1 API, each function should use
// functions.runWith({ maxInstances: 10 }) instead of setGlobalOptions.
// In the v1 API, each function can only serve one request per container,
// so this will be the maximum concurrent request count.

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const stripeSecret =
  process.env.STRIPE_SECRET_KEY ||
  functions.config().stripe?.secret_key;

const stripe = stripeSecret ?
  new Stripe(stripeSecret) :
  undefined;

const webhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET ||
  functions.config().stripe?.webhook_secret;

type PlanType = "plus" | "team";

const planCatalog: Record<PlanType, {amount: number; name: string; description: string}> = {
  plus: {
    amount: 100,
    name: "RocketPrompt Plus",
    description: "Lifetime access to RocketPrompt Plus"
  },
  team: {
    amount: 200,
    name: "RocketPrompt Pro (Team)",
    description: "One year of Team/Pro access"
  }
};

const allowedReturnOrigins = new Set([
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "https://rocketprompt.io",
  "https://www.rocketprompt.io",
  "https://rocket-prompt.web.app",
  "https://rocket-prompt.firebaseapp.com",
  "https://rocketprompt.web.app",
  "https://rocketprompt.firebaseapp.com"
]);

const resolveReturnUrl = (rawUrl: unknown, fallbackOrigin?: string): string => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing return URL."
    );
  }

  try {
    const originToUse =
      fallbackOrigin && allowedReturnOrigins.has(fallbackOrigin) ?
        fallbackOrigin :
        undefined;
    const parsed = new URL(rawUrl, originToUse);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (!allowedReturnOrigins.has(origin)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Return URL is not allowed."
      );
    }

    return parsed.toString();
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid return URL."
    );
  }
};

const getRequestOrigin = (context: functions.https.CallableContext): string | undefined => {
  const raw = context.rawRequest as {headers?: Record<string, unknown>} | undefined;
  const originHeader = raw?.headers?.origin;
  return typeof originHeader === "string" ? originHeader : undefined;
};

export const createCheckoutSession = functions
  .region("us-central1")
  .runWith({secrets: ["STRIPE_SECRET_KEY"]})
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to start checkout."
      );
    }

    if (!stripe) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe is not configured."
      );
    }

    const planKey = typeof data?.plan === "string" ?
      data.plan.toLowerCase() as PlanType :
      undefined;
    const plan = planKey ? planCatalog[planKey] : undefined;

    if (!planKey || !plan) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Unsupported plan requested."
      );
    }

    const requestOrigin = getRequestOrigin(context);
    const successUrl = resolveReturnUrl(data?.successUrl, requestOrigin);
    const cancelUrl = resolveReturnUrl(data?.cancelUrl, requestOrigin);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: plan.name,
                description: plan.description
              },
              unit_amount: plan.amount
            },
            quantity: 1
          }
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: context.auth.uid,
          planType: planKey
        },
        customer_email: typeof context.auth.token.email === "string" ?
          context.auth.token.email :
          undefined
      });

      return {sessionId: session.id, sessionUrl: session.url ?? null};
    } catch (error) {
      functions.logger.error("Failed to create Stripe checkout session", error);
      throw new functions.https.HttpsError(
        "internal",
        "Unable to create checkout session."
      );
    }
  });

/**
 * Updates the user's subscription status after Stripe confirms payment.
 *
 * The Checkout Session must include metadata entries for:
 *   - userId: Firebase Auth UID to update in Firestore
 *   - planType: "plus" | "team"
 */
export const stripeWebhook = functions
  .region("us-central1")
  .runWith({ secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!stripe || !webhookSecret) {
      functions.logger.error("Stripe secrets are not configured.");
      res.status(500).send("Stripe configuration missing.");
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).send("Missing Stripe signature.");
      return;
    }

    let event: Stripe.Event;
    try {
      // Firebase Functions v1 adds rawBody to the request object
      const rawBody =
        (req as { rawBody?: Buffer | string }).rawBody || req.body;
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature as string,
        webhookSecret
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown verification error";
      functions.logger.warn("Stripe signature verification failed", message);
      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    if (event.type !== "checkout.session.completed") {
      res.sendStatus(200);
      return;
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const planType = (session.metadata?.planType || "").toLowerCase();

    if (!userId || (planType !== "plus" && planType !== "team")) {
      functions.logger.error("Missing metadata", { userId, planType });
      res.status(400).send("Missing metadata.");
      return;
    }

    const paidAtMillis =
      (session.created || Math.floor(Date.now() / 1000)) * 1000;
    const paidAt = admin.firestore.Timestamp.fromMillis(paidAtMillis);

    const expiresAt =
      planType === "team" ?
        admin.firestore.Timestamp.fromMillis(
          paidAtMillis + 365 * 24 * 60 * 60 * 1000
        ) :
        null;

    const updates: Record<string, unknown> = {
      subscriptionStatus: planType === "team" ? "team" : "pro",
      subscriptionPaidAt: paidAt,
    };

    if (expiresAt) {
      updates.subscriptionExpiresAt = expiresAt;
    } else {
      updates.subscriptionExpiresAt = admin.firestore.FieldValue.delete();
    }

    try {
      await admin.firestore().collection("users").doc(userId).set(
        updates,
        { merge: true }
      );
      functions.logger.info("Updated subscription", { userId, planType });
      res.sendStatus(200);
    } catch (error) {
      functions.logger.error("Failed to update user subscription", error);
      res.status(500).send("Failed to update subscription.");
    }
  });
