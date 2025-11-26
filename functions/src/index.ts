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
import { GoogleAuth } from "google-auth-library";

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

const planCatalog: Record<PlanType, { amount: number; name: string; description: string }> = {
  plus: {
    amount: 1999,
    name: "RocketPrompt Plus",
    description: "Lifetime access to RocketPrompt Plus"
  },
  team: {
    amount: 9999,
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
  const raw = context.rawRequest as { headers?: Record<string, unknown> } | undefined;
  const originHeader = raw?.headers?.origin;
  return typeof originHeader === "string" ? originHeader : undefined;
};

export const createCheckoutSession = functions
  .region("us-central1")
  .runWith({ secrets: ["STRIPE_SECRET_KEY"] })
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

      return { sessionId: session.id, sessionUrl: session.url ?? null };
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
      subscriptionStatus: planType === "team" ? "pro" : "plus",
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

// Vertex AI setup for image generation (uses Firebase service account credentials)
const PROJECT_ID = "rocket-prompt";
const LOCATION = "us-central1";

interface BulkPromptInput {
  title: string;
  content: string;
  tag: string;
  customUrl?: string;
  views?: number;
  likes?: number;
  launchGpt?: number;
  launchGemini?: number;
  launchClaude?: number;
  copied?: number;
  isInvisible?: boolean;
}

interface BulkUploadResult {
  promptId: string;
  title: string;
  imageUrl?: string;
  error?: string;
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates an image using Google's Vertex AI Imagen 4 API based on the prompt content
 * and uploads it to Firebase Storage.
 * Uses Imagen 4 - Google's best and most stable image generation model.
 * Includes retry logic with exponential backoff for rate limiting.
 */
async function generateThumbnailImage(
  promptText: string,
  promptId: string,
  batchId: string,
  retryCount: number = 0
): Promise<string | null> {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 3000; // 3 seconds base delay - Imagen 4 has better rate limits

  try {
    // Get access token using Google Auth
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    // Create a simplified prompt for thumbnail generation
    const imagePrompt = `A visually appealing, artistic thumbnail image representing: ${promptText.substring(0, 400)}. Modern, vibrant, visually striking, no text in image.`;

    // Call Imagen 4 API
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-4.0-generate-001:predict`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: imagePrompt,
          },
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
          outputOptions: {
            mimeType: "image/png",
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Imagen API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as {
      predictions?: Array<{
        bytesBase64Encoded?: string;
        mimeType?: string;
      }>;
    };

    // Extract the image from the response
    const prediction = result.predictions?.[0];
    const imageData = prediction?.bytesBase64Encoded;
    const mimeType = prediction?.mimeType || "image/png";

    if (!imageData) {
      functions.logger.warn("No image data returned from Imagen 4", {
        promptId,
        hasResponse: !!result,
        predictionCount: result.predictions?.length || 0,
      });
      return null;
    }

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const fileExtension = mimeType.split("/")[1] || "png";
    const fileName = `bulk-prompts/${batchId}/${promptId}/thumbnail.${fileExtension}`;
    const file = bucket.file(fileName);

    // Decode base64 and upload
    const imageBuffer = Buffer.from(imageData, "base64");

    await file.save(imageBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          promptId: promptId,
          batchId: batchId,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    // Make the file publicly accessible and get the download URL
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    functions.logger.info(`Generated thumbnail for prompt ${promptId}: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a rate limit error (429) or quota error
    if ((errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) && retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
      functions.logger.warn(`Rate limited, retrying in ${delayMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`, {
        promptId,
      });
      await sleep(delayMs);
      return generateThumbnailImage(promptText, promptId, batchId, retryCount + 1);
    }

    functions.logger.error("Failed to generate thumbnail image", {
      error: errorMessage,
      promptId,
      batchId,
      retryCount,
    });
    return null;
  }
}

/**
 * Cloud Function to bulk create prompts with optional auto-generated thumbnails.
 * This function processes an array of prompts, optionally generates thumbnails
 * using Gemini API, and saves everything to Firestore.
 */
export const bulkCreatePromptsWithThumbnails = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 540, // 9 minutes max for long batches
    memory: "1GB",
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to create prompts."
      );
    }

    const authorId = context.auth.uid;

    // Validate input
    const prompts = data?.prompts as BulkPromptInput[] | undefined;
    const autoThumbnail = data?.autoThumbnail === true;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "An array of prompts is required."
      );
    }

    if (prompts.length > 100) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Maximum 100 prompts per batch."
      );
    }

    // Generate a unique batch ID for this upload
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const results: BulkUploadResult[] = [];
    const firestore = admin.firestore();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    for (const promptInput of prompts) {
      try {
        const title = promptInput.title?.trim();
        const content = promptInput.content?.trim();
        const tag = promptInput.tag?.trim()?.toLowerCase();

        if (!title || !content || !tag) {
          results.push({
            promptId: "",
            title: promptInput.title || "Unknown",
            error: "Missing required fields (title, content, or tag)",
          });
          continue;
        }

        // Prepare prompt data
        const views = typeof promptInput.views === "number" && promptInput.views >= 0 ? promptInput.views : 0;
        const likes = typeof promptInput.likes === "number" && promptInput.likes >= 0 ? promptInput.likes : 0;
        const launchGpt = typeof promptInput.launchGpt === "number" && promptInput.launchGpt >= 0 ? promptInput.launchGpt : 0;
        const launchGemini = typeof promptInput.launchGemini === "number" && promptInput.launchGemini >= 0 ? promptInput.launchGemini : 0;
        const launchClaude = typeof promptInput.launchClaude === "number" && promptInput.launchClaude >= 0 ? promptInput.launchClaude : 0;
        const launchGrok = 0;
        const copied = typeof promptInput.copied === "number" && promptInput.copied >= 0 ? promptInput.copied : 0;
        const totalLaunch = launchGpt + launchGemini + launchClaude + launchGrok + copied;

        const promptData: Record<string, unknown> = {
          authorId,
          title,
          content,
          tag,
          views,
          likes,
          launchGpt,
          launchGemini,
          launchClaude,
          launchGrok,
          copied,
          totalLaunch,
          createdAt: timestamp,
          updatedAt: timestamp,
          bulkUploadBatchId: batchId,
        };

        if (promptInput.customUrl?.trim()) {
          promptData.customUrl = promptInput.customUrl.trim();
        }

        if (promptInput.isInvisible === true) {
          promptData.isInvisible = true;
        }

        // Create the prompt document first
        const docRef = await firestore.collection("prompts").add(promptData);
        const promptId = docRef.id;

        let imageUrl: string | undefined;

        // Generate thumbnail if autoThumbnail is enabled
        if (autoThumbnail) {
          const generatedUrl = await generateThumbnailImage(content, promptId, batchId);
          if (generatedUrl) {
            imageUrl = generatedUrl;
            // Update the prompt with the image URL
            await docRef.update({ imageUrl });
          }
          // Add delay between image generations to avoid rate limiting
          // Imagen 4 has better rate limits, 5 second delay should be sufficient
          await sleep(5000);
        }

        results.push({
          promptId,
          title,
          imageUrl,
        });

        functions.logger.info(`Created prompt ${promptId}: ${title}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          promptId: "",
          title: promptInput.title || "Unknown",
          error: errorMessage,
        });
        functions.logger.error(`Failed to create prompt: ${promptInput.title}`, error);
      }
    }

    const successCount = results.filter(r => !r.error).length;
    const failedCount = results.filter(r => r.error).length;

    functions.logger.info(`Bulk upload complete: ${successCount} succeeded, ${failedCount} failed`);

    return {
      batchId,
      results,
      summary: {
        total: prompts.length,
        success: successCount,
        failed: failedCount,
      },
    };
  });

/**
 * Cloud Function to generate a single thumbnail for an existing prompt.
 * Useful for regenerating thumbnails or adding thumbnails to existing prompts.
 */
export const generatePromptThumbnail = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 120,
    memory: "512MB",
  })
  .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to generate thumbnails."
      );
    }

    const promptId = data?.promptId as string | undefined;

    if (!promptId?.trim()) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A prompt ID is required."
      );
    }

    const firestore = admin.firestore();
    const promptDoc = await firestore.collection("prompts").doc(promptId).get();

    if (!promptDoc.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Prompt not found."
      );
    }

    const promptData = promptDoc.data() as Record<string, unknown>;
    const content = typeof promptData.content === "string" ? promptData.content : "";
    const authorId = typeof promptData.authorId === "string" ? promptData.authorId : "";

    // Verify ownership or admin status
    if (authorId !== context.auth.uid) {
      // Check if user is admin
      const userDoc = await firestore.collection("users").doc(context.auth.uid).get();
      const userData = userDoc.data() as Record<string, unknown> | undefined;
      const isAdmin = userData?.role === "admin" || userData?.admin === true;

      if (!isAdmin) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only generate thumbnails for your own prompts."
        );
      }
    }

    if (!content) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Prompt has no content to generate a thumbnail from."
      );
    }

    // Generate thumbnail
    const batchId = `single-${Date.now()}`;
    const imageUrl = await generateThumbnailImage(content, promptId, batchId);

    if (!imageUrl) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to generate thumbnail image."
      );
    }

    // Update the prompt with the new image URL
    await firestore.collection("prompts").doc(promptId).update({
      imageUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      promptId,
      imageUrl,
    };
  });
